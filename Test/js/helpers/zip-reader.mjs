// The in-test ZIP reader: parses a store-only ZIP written by zip.js and checks its structure as it goes.
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';

/** Parse a ZIP: EOCD, then each central entry and the local header it points at. */
export function readZip(zip) {
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
