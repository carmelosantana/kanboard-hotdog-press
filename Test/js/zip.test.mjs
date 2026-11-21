// The store-only ZIP writer: structure checked by a small in-test reader (CRCs from node:zlib), and by unzip -t.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipStore } from '../../Assets/js/core/zip.js';

const bytes = (s) => new TextEncoder().encode(s);

/** Parse a ZIP: EOCD, then each central entry and the local header it points at. */
function readZip(zip) {
  assert.ok(zip instanceof Uint8Array, 'output is a Uint8Array');
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22; // no archive comment
  assert.equal(v.getUint32(eocd, true), 0x06054b50, 'EOCD signature');
  const count = v.getUint16(eocd + 10, true);
  assert.equal(v.getUint16(eocd + 8, true), count, 'entries on this disk = total');
  const cdSize = v.getUint32(eocd + 12, true);
  const cdAt = v.getUint32(eocd + 16, true);
  assert.equal(cdAt + cdSize, eocd, 'central directory ends at the EOCD');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries = [];
  let at = cdAt;
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(at, true), 0x02014b50, `central header ${i} signature`);
    const flags = v.getUint16(at + 8, true);
    const method = v.getUint16(at + 10, true);
    const [time, date] = [v.getUint16(at + 12, true), v.getUint16(at + 14, true)];
    const crc = v.getUint32(at + 16, true);
    const [csize, usize] = [v.getUint32(at + 20, true), v.getUint32(at + 24, true)];
    const [nameLen, extraLen, commentLen] = [v.getUint16(at + 28, true), v.getUint16(at + 30, true),
      v.getUint16(at + 32, true)];
    const localAt = v.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;

    assert.equal(v.getUint32(localAt, true), 0x04034b50, `local header of ${name}`);
    assert.equal(v.getUint16(localAt + 6, true), flags, 'local flags match');
    assert.equal(v.getUint16(localAt + 8, true), method, 'local method matches');
    assert.equal(v.getUint16(localAt + 10, true), time, 'local time matches');
    assert.equal(v.getUint16(localAt + 12, true), date, 'local date matches');
    assert.equal(v.getUint32(localAt + 14, true), crc, 'local CRC matches');
    assert.equal(v.getUint32(localAt + 18, true), csize, 'local compressed size matches');
    assert.equal(v.getUint32(localAt + 22, true), usize, 'local size matches');
    const localNameLen = v.getUint16(localAt + 26, true);
    const dataAt = localAt + 30 + localNameLen + v.getUint16(localAt + 28, true);
    assert.equal(decoder.decode(zip.subarray(localAt + 30, localAt + 30 + localNameLen)), name, 'local name');
    const data = zip.subarray(dataAt, dataAt + csize);
    assert.equal(crc32(data), crc, `CRC-32 of ${name}`);
    entries.push({ name, flags, method, time, date, crc, csize, usize, data, localAt });
  }
  assert.equal(at, cdAt + cdSize, 'central directory size');
  return entries;
}

const files = () => [
  { name: 'hotdog-zine-carousel-3x4-01.png', data: bytes('one') },
  { name: 'folder/ünïcode-🌭.txt', data: bytes('hot dog press\n') },
  { name: 'empty.bin', data: new Uint8Array(0) },
];

test('zipStore writes stored entries in order with correct CRCs, sizes and UTF-8 names', () => {
  const entries = readZip(zipStore(files()));
  assert.deepEqual(entries.map((e) => e.name), files().map((f) => f.name));
  for (const [i, e] of entries.entries()) {
    assert.equal(e.method, 0, 'stored');
    assert.equal(e.flags, 0x0800, 'general-purpose bit 11: UTF-8 names');
    assert.equal(e.csize, files()[i].data.length);
    assert.equal(e.usize, files()[i].data.length);
    assert.deepEqual([...e.data], [...files()[i].data]);
  }
  assert.equal(entries[0].crc, crc32(bytes('one')));
  assert.equal(entries[2].crc, 0, 'CRC of nothing is 0');
});

test('zipStore stamps 1980-01-01 00:00 when no date is given, so output is deterministic', () => {
  const [e] = readZip(zipStore([{ name: 'a.txt', data: bytes('a') }]));
  assert.equal(e.date, (0 << 9) | (1 << 5) | 1);
  assert.equal(e.time, 0);
  assert.deepEqual(zipStore(files()), zipStore(files()));
});

test('zipStore writes a given date as a DOS date and time (local fields, 2-second resolution)', () => {
  const date = new Date(2026, 10, 21, 13, 45, 31); // 2026-11-21 13:45:31 local
  const [e] = readZip(zipStore([{ name: 'a.txt', data: bytes('a'), date }]));
  assert.equal(e.date, ((2026 - 1980) << 9) | (11 << 5) | 21);
  assert.equal(e.time, (13 << 11) | (45 << 5) | 15);
});

test('zipStore clamps dates before 1980 to the DOS epoch', () => {
  const [e] = readZip(zipStore([{ name: 'a.txt', data: bytes('a'), date: new Date(1970, 0, 1) }]));
  assert.equal(e.date, (1 << 5) | 1);
  assert.equal(e.time, 0);
});

test('zipStore of no files is an empty archive (just the EOCD)', () => {
  const zip = zipStore([]);
  assert.equal(zip.length, 22);
  assert.deepEqual(readZip(zip), []);
});

test('zipStore rejects duplicate names, parent segments, absolute paths, empty names and non-byte data', () => {
  const one = (name, data = bytes('x')) => () => zipStore([{ name, data }]);
  assert.throws(() => zipStore([{ name: 'a.png', data: bytes('1') }, { name: 'a.png', data: bytes('2') }]),
    /Duplicate/);
  assert.throws(one('../evil.png'), /\.\./);
  assert.throws(one('a/../../evil.png'), /\.\./);
  assert.throws(one('a/..'), /\.\./);
  assert.throws(one('/etc/passwd'), /leading/);
  assert.throws(one(''), /name/);
  assert.throws(one(42), /name/);
  assert.throws(one('a.txt', 'text'), /Uint8Array/);
  assert.throws(() => zipStore('nope'), /array/);
  // A double dot inside a name is fine; only a `..` path segment is a traversal.
  assert.equal(readZip(zipStore([{ name: 'a..b.png', data: bytes('1') }]))[0].name, 'a..b.png');
});

test('unzip -t accepts the archive and lists the UTF-8 names', { skip: !hasUnzip() && 'unzip not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hotdog-zip-'));
  try {
    const path = join(dir, 'social.zip');
    writeFileSync(path, zipStore(files().map((f) => ({ ...f, date: new Date(2026, 10, 21, 9, 30, 0) }))));
    const out = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
    assert.match(out, /No errors detected/);
    for (const f of files()) assert.ok(out.includes(f.name), `lists ${f.name}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function hasUnzip() {
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
}
