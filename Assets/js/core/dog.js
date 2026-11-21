// The Dog (*.hotdog): the exact zine document. New, migrate and validate. Pure, no DOM.
// Model/DogValidator.php mirrors validateDog rule for rule; Test/fixtures/dog drives both.

import { PAPERS, paperSize, DEFAULT_MARGIN_MM, MAX_MARGIN_MM } from './paper.js?v=0.1.0';

/** @typedef {{path: string, message: string}} DogError */
/** @typedef {{ok: true, dog: object} | {ok: false, errors: DogError[]}} DogResult */

export const DOG_VERSION = 1;
export const MAX_DOG_BYTES = 2 * 1024 * 1024;
export const MAX_INK_POINTS = 5000;
export const MAX_TEXT_CHARS = 2000;
/** An optional issue label: a string of at most this many characters, or a whole number of 0 or more. */
export const MAX_ISSUE_CHARS = 32;
/** Item geometry in panel units may reach a panel beyond either edge (bleed, drag-off). */
export const MIN_UNIT = -1;
export const MAX_UNIT = 2;

export const PAPER_IDS = Object.freeze(Object.keys(PAPERS));
export const LAYOUT_NAMES = Object.freeze([
  'cover', 'back-cover', 'headline-body', 'photo-full', 'photo-caption', 'list', 'quote', 'two-up', 'freeform',
]);
const NUMERIC_ID = /^[0-9]+$/;
export const BY_VALUES = Object.freeze(['hand', 'ai', 'import']);

/** Allowed fields per object, for strict mode: an item may carry `item` plus its own type's fields. */
export const FIELDS = Object.freeze({
  dog: Object.freeze(['hotdog', 'id', 'title', 'issue', 'paper', 'margin_mm', 'look', 'assets', 'pages']),
  page: Object.freeze(['id', 'layout', 'bg', 'items']),
  item: Object.freeze(['id', 'type', 'x', 'y', 'w', 'h', 'rot', 'by', 'locked', 'slot', 'attrs']),
  types: Object.freeze({
    text: Object.freeze(['font', 'size', 'align', 'color', 'runs']),
    image: Object.freeze(['asset', 'fit', 'focus', 'crop']),
    shape: Object.freeze(['shape', 'fill', 'stroke', 'stroke_width']),
    ink: Object.freeze(['points', 'width', 'color']),
    sticker: Object.freeze(['asset']),
  }),
  asset: Object.freeze(['kind', 'file_id', 'data', 'w', 'h', 'name']),
});
export const ITEM_TYPES = Object.freeze(Object.keys(FIELDS.types));

/** MIGRATIONS[v] turns a version-v Dog into version v+1. */
const MIGRATIONS = [
  (dog) => dog, // 0 → 1: no shape change; the hook exists for Dog 2.
];

/**
 * A blank Dog 1: eight empty freeform pages.
 * @param {{title?: string, paper?: string}} [opts]
 */
export function newDog({ title = '', paper = 'letter' } = {}) {
  paperSize(paper);
  return {
    hotdog: DOG_VERSION,
    id: randomId(),
    title,
    paper,
    margin_mm: DEFAULT_MARGIN_MM,
    look: 'kraft',
    assets: {},
    pages: Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, layout: 'freeform', bg: 'paper', items: [] })),
  };
}

/**
 * Brings an older Dog forward to DOG_VERSION; a missing `hotdog` counts as 0. Returns a copy; anything that is
 * not an object, or whose version is not a known older one, comes back unchanged for validateDog to report.
 * @param {any} json
 */
export function migrateDog(json) {
  if (!isObject(json)) return json;
  let dog = structuredClone(json);
  let v = dog.hotdog === undefined ? 0 : dog.hotdog;
  if (!Number.isInteger(v) || v < 0) return dog;
  while (v < DOG_VERSION) {
    const { hotdog, ...rest } = MIGRATIONS[v](dog);
    v += 1;
    dog = { hotdog: v, ...rest };
  }
  return dog;
}

/**
 * Migrates, then checks every rule. Lenient keeps unknown fields; strict reports them.
 * @param {any} input a Dog object or its JSON text
 * @param {{mode?: 'lenient'|'strict'}} [opts]
 * @returns {DogResult}
 */
export function validateDog(input, { mode = 'lenient' } = {}) {
  let json = input;
  if (typeof input === 'string') {
    try {
      json = JSON.parse(input);
    } catch {
      return fail('', 'must be valid JSON');
    }
  }
  if (!isObject(json)) return fail('', 'must be an object');
  let text;
  try {
    text = JSON.stringify(json); // throws on a cycle or a BigInt
  } catch {
    return fail('', 'must be valid JSON');
  }
  if (new TextEncoder().encode(text).length > MAX_DOG_BYTES) {
    return fail('', `must be at most ${MAX_DOG_BYTES} bytes of JSON`);
  }

  const dog = migrateDog(json);
  const errors = [];
  const err = (segments, message) => errors.push({ path: segments.map(escapeSegment).join('/'), message });
  const strict = mode === 'strict';
  const unknown = (obj, allowed, at) => {
    if (!strict) return;
    for (const key of Object.keys(obj)) if (!allowed.includes(key)) err([...at, key], 'unknown field');
  };

  unknown(dog, FIELDS.dog, []);
  if (dog.hotdog !== DOG_VERSION) err(['hotdog'], 'must be the integer 1');
  if (dog.issue !== undefined && !validIssue(dog.issue)) {
    err(['issue'], `must be a string of at most ${MAX_ISSUE_CHARS} characters or an integer of 0 or more`);
  }
  if (!PAPER_IDS.includes(dog.paper)) err(['paper'], `must be one of ${PAPER_IDS.join(', ')}`);
  if (!inRange(dog.margin_mm, 0, MAX_MARGIN_MM)) err(['margin_mm'], `must be a number from 0 to ${MAX_MARGIN_MM}`);

  const assets = isObject(dog.assets) ? dog.assets : {};
  if (!isObject(dog.assets)) err(['assets'], 'must be an object');
  for (const [key, asset] of Object.entries(assets)) {
    // PHP decodes an object with only numeric keys as a list, so ids like "0" are refused in both languages.
    if (NUMERIC_ID.test(key)) err(['assets', key], 'must not be a numeric-only id');
    else if (!isObject(asset)) err(['assets', key], 'must be an object');
    else unknown(asset, FIELDS.asset, ['assets', key]);
  }

  if (!Array.isArray(dog.pages)) {
    err(['pages'], 'must be an array');
  } else {
    if (dog.pages.length !== 8) err(['pages'], 'must have exactly 8 pages');
    const pageIds = new Set();
    const itemIds = new Set();
    dog.pages.forEach((page, p) => {
      const at = ['pages', p];
      if (!isObject(page)) return err(at, 'must be an object');
      unknown(page, FIELDS.page, at);
      checkId(page.id, pageIds, [...at, 'id'], 'duplicate page id', err);
      if (!LAYOUT_NAMES.includes(page.layout)) err([...at, 'layout'], 'must be a known layout');
      if (!Array.isArray(page.items)) return err([...at, 'items'], 'must be an array');
      page.items.forEach((item, i) => checkItem(item, [...at, 'items', i], { assets, itemIds, err, unknown }));
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true, dog };
}

function checkItem(item, at, { assets, itemIds, err, unknown }) {
  if (!isObject(item)) return err(at, 'must be an object');
  const typed = ITEM_TYPES.includes(item.type);
  if (typed) unknown(item, [...FIELDS.item, ...FIELDS.types[item.type]], at);
  checkId(item.id, itemIds, [...at, 'id'], 'duplicate item id', err);
  if (!typed) err([...at, 'type'], `must be one of ${ITEM_TYPES.join(', ')}`);
  // An ink stroke's geometry is its points, so its box is optional (checked when present).
  const box = (k) => item.type !== 'ink' || item[k] !== undefined;
  for (const k of ['x', 'y']) {
    if (box(k) && !inRange(item[k], MIN_UNIT, MAX_UNIT)) err([...at, k], `must be a number from ${MIN_UNIT} to ${MAX_UNIT}`);
  }
  for (const k of ['w', 'h']) {
    if (box(k) && (!inRange(item[k], MIN_UNIT, MAX_UNIT) || item[k] <= 0)) {
      err([...at, k], `must be a number greater than 0 and at most ${MAX_UNIT}`);
    }
  }
  if (!BY_VALUES.includes(item.by)) err([...at, 'by'], `must be one of ${BY_VALUES.join(', ')}`);

  if (item.type === 'image' || item.type === 'sticker') {
    if (typeof item.asset !== 'string' || !Object.hasOwn(assets, item.asset)) {
      err([...at, 'asset'], 'must name an entry in assets');
    }
  } else if (item.type === 'ink') {
    const unit = (v) => inRange(v, MIN_UNIT, MAX_UNIT);
    const pairs = Array.isArray(item.points)
      && item.points.every((pt) => Array.isArray(pt) && pt.length === 2 && unit(pt[0]) && unit(pt[1]));
    if (!pairs) err([...at, 'points'], `must be an array of [x, y] pairs from ${MIN_UNIT} to ${MAX_UNIT}`);
    else if (item.points.length > MAX_INK_POINTS) err([...at, 'points'], `must have at most ${MAX_INK_POINTS} points`);
  } else if (item.type === 'text') {
    const runs = Array.isArray(item.runs) && item.runs.every((r) => isObject(r) && typeof r.text === 'string');
    if (!runs) err([...at, 'runs'], 'must be an array of runs with string text');
    else if (item.runs.reduce((n, r) => n + codePoints(r.text), 0) > MAX_TEXT_CHARS) {
      err([...at, 'runs'], `must have at most ${MAX_TEXT_CHARS} characters in total`);
    }
  }
}

function checkId(id, seen, path, duplicate, err) {
  if (typeof id !== 'string' || id === '') return err(path, 'must be a non-empty string');
  if (seen.has(id)) return err(path, duplicate);
  seen.add(id);
}

const validIssue = (v) => (typeof v === 'string' ? codePoints(v) <= MAX_ISSUE_CHARS : Number.isInteger(v) && v >= 0);
const fail = (path, message) => ({ ok: false, errors: [{ path, message }] });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inRange = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
/** Characters as code points, so JS and PHP (mb_strlen) count the same. */
const codePoints = (s) => { let n = 0; for (const _ of s) n += 1; return n; };
/** JSON-pointer escaping (RFC 6901) of one path segment. */
const escapeSegment = (s) => String(s).replaceAll('~', '~0').replaceAll('/', '~1');

/** `z_` + 8 lowercase base36 characters. */
export function randomId() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return 'z_' + Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}
