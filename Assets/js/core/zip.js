// A store-only ZIP writer (no compression, no ZIP64): local headers, central directory, end record. Pure, no DOM.
// PNG and JPEG are already compressed, so storing them costs nothing and keeps this small.

/** @typedef {{name: string, data: Uint8Array, date?: Date}} ZipFile */

const FLAG_UTF8 = 0x0800; // general-purpose bit 11: the name is UTF-8
const VERSION = 20;
// Made by Unix: unzip translates names from DOS-origin archives through an OEM code page even with bit 11 set.
const MADE_BY = (3 << 8) | VERSION;
const FILE_MODE = 0o100644; // a regular file, rw-r--r--, in the high half of the external attributes
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

/** The CRC-32 (IEEE, reflected 0xEDB88320) table, built once on first use. */
let crcTable;
function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * DOS date and time from the Date's local fields (2-second resolution). Missing, invalid or pre-1980 dates are
 * 1980-01-01 00:00, so an archive written without dates is byte-for-byte reproducible.
 * @param {Date|undefined} date
 */
function dosDateTime(date) {
  if (!(date instanceof Date) || !(date.getFullYear() >= 1980)) return { date: (1 << 5) | 1, time: 0 };
  const year = Math.min(date.getFullYear(), 2107) - 1980;
  return {
    date: (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
  };
}

/** @param {unknown} name @param {Set<string>} seen */
function checkName(name, seen) {
  if (typeof name !== 'string' || name === '') throw new Error('Each ZIP entry needs a non-empty string name');
  if (name.startsWith('/')) throw new Error(`ZIP entry name has a leading slash: ${name}`);
  if (name.split('/').includes('..')) throw new Error(`ZIP entry name has a .. segment: ${name}`);
  if (seen.has(name)) throw new Error(`Duplicate ZIP entry name: ${name}`);
  seen.add(name);
}

/**
 * Write a store-only ZIP of the files, in the order given.
 * @param {ZipFile[]} files
 * @returns {Uint8Array}
 */
export function zipStore(files) {
  if (!Array.isArray(files)) throw new Error('zipStore needs an array of {name, data, date?}');
  if (files.length > MAX_U16) throw new Error('Too many ZIP entries');
  const encoder = new TextEncoder();
  const seen = new Set();
  const entries = files.map(({ name, data, date }) => {
    checkName(name, seen);
    if (!(data instanceof Uint8Array)) throw new Error(`ZIP entry data must be a Uint8Array: ${name}`);
    return { name: encoder.encode(name), data, crc: crc32(data), ...dosDateTime(date) };
  });

  const localSize = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);
  if (localSize + centralSize > MAX_U32) throw new Error('ZIP too large (no ZIP64)');
  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);
  const u16 = (at, x) => v.setUint16(at, x, true);
  const u32 = (at, x) => v.setUint32(at, x, true);

  /** The fields local and central headers share, from "version needed" to the name length. */
  const common = (at, e) => {
    u16(at, VERSION);
    u16(at + 2, FLAG_UTF8);
    u16(at + 4, 0); // stored
    u16(at + 6, e.time);
    u16(at + 8, e.date);
    u32(at + 10, e.crc);
    u32(at + 14, e.data.length);
    u32(at + 18, e.data.length);
    u16(at + 22, e.name.length);
  };

  let at = 0;
  for (const e of entries) {
    e.offset = at;
    u32(at, 0x04034b50);
    common(at + 4, e);
    out.set(e.name, at + 30);
    out.set(e.data, at + 30 + e.name.length);
    at += 30 + e.name.length + e.data.length;
  }
  for (const e of entries) {
    u32(at, 0x02014b50);
    u16(at + 4, MADE_BY);
    common(at + 6, e);
    // extra, comment, disk and internal attributes stay 0
    u32(at + 38, FILE_MODE * 0x10000);
    u32(at + 42, e.offset);
    out.set(e.name, at + 46);
    at += 46 + e.name.length;
  }
  u32(at, 0x06054b50);
  u16(at + 8, entries.length);
  u16(at + 10, entries.length);
  u32(at + 12, centralSize);
  u32(at + 16, localSize);
  return out;
}
