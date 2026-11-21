// Document edits the editor makes, as pure functions: each takes a (frozen) Dog and returns a new one, or the same Dog
// when nothing changes. Item factories make hand-made items. No DOM.
import { randomId } from '../core/dog.js';
import { LAYOUTS, place, BULLET } from '../core/layouts.js';
import { clampMargin } from '../core/paper.js';

/** The shared placeholder asset an empty image slot points at until a photo replaces it. */
export const PLACEHOLDER_ASSET = 'placeholder';

const clone = (v) => structuredClone(v);
const newId = (prefix) => `${prefix}_${randomId()}`;

/**
 * Where an item is: its page index, its index on the page and the item.
 * @returns {{page: number, index: number, item: any}|null}
 */
export function findItem(doc, id) {
  for (let p = 0; p < doc.pages.length; p++) {
    const index = doc.pages[p].items.findIndex((it) => it.id === id);
    if (index >= 0) return { page: p, index, item: doc.pages[p].items[index] };
  }
  return null;
}

/** @param {any} doc @param {number} page @param {any} item */
export function addItem(doc, page, item) {
  return withPage(doc, page, (p) => ({ ...p, items: [...p.items, item] }));
}

/**
 * Merges `patch` into the item. A locked item only accepts `{locked}` (so it can be unlocked).
 * @param {any} doc @param {string} id @param {object} patch
 */
export function updateItem(doc, id, patch) {
  const at = findItem(doc, id);
  if (!at) return doc;
  if (at.item.locked === true && Object.keys(patch).some((k) => k !== 'locked')) return doc;
  return withPage(doc, at.page, (p) => ({
    ...p, items: p.items.map((it, i) => (i === at.index ? { ...it, ...patch } : it)),
  }));
}

/** Removes the items with these ids, except locked ones. */
export function removeItems(doc, ids) {
  const gone = new Set(ids);
  const pages = doc.pages.map((p) => {
    const items = p.items.filter((it) => !gone.has(it.id) || it.locked === true);
    return items.length === p.items.length ? p : { ...p, items };
  });
  return pages.every((p, i) => p === doc.pages[i]) ? doc : dropUnusedPlaceholder({ ...doc, pages });
}

/** Locks every listed item, or unlocks them all when they are all locked already. */
export function toggleLock(doc, ids) {
  const items = ids.map((id) => findItem(doc, id)?.item).filter(Boolean);
  if (!items.length) return doc;
  const lock = !items.every((it) => it.locked === true);
  const set = new Set(ids);
  return {
    ...doc,
    pages: doc.pages.map((p) => ({
      ...p,
      items: p.items.map((it) => {
        if (!set.has(it.id)) return it;
        const { locked, ...rest } = it;
        return lock ? { ...rest, locked: true } : rest;
      }),
    })),
  };
}

/** Moves the page at `from` (with its items and id) to position `to`; the pages between shift by one. */
export function movePage(doc, from, to) {
  if (from === to || from < 0 || to < 0 || from >= doc.pages.length || to >= doc.pages.length) return doc;
  const pages = [...doc.pages];
  const [moved] = pages.splice(from, 1);
  pages.splice(to, 0, moved);
  return { ...doc, pages };
}

/** @param {any} doc @param {string} id @param {object} asset */
export function addAsset(doc, id, asset) {
  return { ...doc, assets: { ...doc.assets, [id]: asset } };
}

/** @param {any} doc @param {unknown} mm */
export function setMargin(doc, mm) {
  const margin_mm = clampMargin(mm);
  return margin_mm === doc.margin_mm ? doc : { ...doc, margin_mm };
}

/**
 * Applies a layout to one page: its slot items are placed in the page's safe area. Free hand items and locked items
 * stay; every other item (slot items, items by ai or import) is replaced, and slot content (text, list lines, photos)
 * moves into the new layout's slots, by slot name first and then in order of kind. An empty photo slot points at the
 * placeholder asset.
 * @param {any} doc @param {number} pageIndex 0..7 @param {string} layout
 */
export function applyLayout(doc, pageIndex, layout) {
  const page = doc.pages[pageIndex];
  const keep = (it) => it.locked === true || (it.by === 'hand' && typeof it.slot !== 'string');
  const kept = page.items.filter(keep);
  const pool = page.items.filter((it) => !keep(it)).map(contentOf).filter(Boolean);

  const defs = LAYOUTS[layout].slots;
  const fills = {};
  const take = (pred) => {
    const i = pool.findIndex(pred);
    return i < 0 ? null : pool.splice(i, 1)[0];
  };
  const isImage = (def) => def.kind === 'image';
  for (const def of defs) {
    const c = take((c) => c.slot === def.name && c.image === isImage(def));
    if (c) fills[def.name] = c;
  }
  for (const def of defs) {
    if (fills[def.name]) continue;
    fills[def.name] = take((c) => c.image === isImage(def)) ?? { image: isImage(def), lines: [], by: 'hand' };
  }

  let needsPlaceholder = false;
  const slots = Object.fromEntries(defs.map((def) => {
    const c = fills[def.name];
    if (def.kind === 'image') {
      needsPlaceholder ||= !c.asset;
      return [def.name, { asset: c.asset ?? PLACEHOLDER_ASSET, by: c.by }];
    }
    if (def.kind === 'list') return [def.name, { items: c.lines, by: c.by }];
    return [def.name, { text: c.lines.join('\n'), by: c.by }];
  }));
  const placed = place(layout, slots, doc.paper, { margin_mm: doc.margin_mm, page: pageIndex + 1 });

  let next = withPage(doc, pageIndex, (p) => ({ ...p, layout, items: [...placed, ...kept] }));
  if (needsPlaceholder && !(PLACEHOLDER_ASSET in next.assets)) {
    next = addAsset(next, PLACEHOLDER_ASSET, { kind: 'placeholder', name: 'photo' });
  }
  return dropUnusedPlaceholder(next);
}

/** What a replaced item carries into a new slot: its photo, or its text as lines. */
function contentOf(it) {
  if (it.type === 'image') {
    return { slot: it.slot, image: true, asset: it.asset === PLACEHOLDER_ASSET ? undefined : it.asset, by: it.by };
  }
  if (it.type !== 'text') return null;
  const texts = (it.runs ?? []).map((r) => String(r.text ?? ''));
  const lines = texts.every((t) => t.startsWith(BULLET)) && texts.length
    ? texts.map((t) => t.slice(BULLET.length).trim())
    : texts.join('').split('\n');
  return { slot: it.slot, image: false, lines: lines.filter((l, i) => l !== '' || i < lines.length - 1), by: it.by };
}

/**
 * Mustard Apply: the compiled Dog's pages and settings, plus the zine's own hand-made and locked items that the
 * text did not bring back (by id). A locked item always keeps its current version. The zine keeps its id.
 * @param {any} doc the zine now
 * @param {any} compiled compileMustard(…).dog, compiled with `from: doc`
 */
export function applyMustard(doc, compiled) {
  const next = clone(compiled);
  next.id = doc.id;
  const placed = new Map();
  next.pages.forEach((p, pi) => p.items.forEach((it, i) => placed.set(it.id, [pi, i])));
  doc.pages.forEach((p, pi) => {
    p.items.forEach((it, i) => {
      const protectedItem = it.locked === true || it.by === 'hand';
      if (!protectedItem) return;
      const at = placed.get(it.id);
      if (at && it.locked === true) {
        next.pages[at[0]].items[at[1]] = clone(it);
      } else if (!at) {
        // After the nearest earlier item of the same page that is on the compiled page, so z-order holds.
        const items = next.pages[pi].items;
        let pos = 0;
        for (let j = i - 1; j >= 0; j--) {
          const k = items.findIndex((x) => x.id === p.items[j].id);
          if (k >= 0) { pos = k + 1; break; }
        }
        items.splice(pos, 0, clone(it));
        placed.set(it.id, [pi, pos]);
      } else {
        return;
      }
      if (typeof it.asset === 'string' && doc.assets[it.asset] && !next.assets[it.asset]) {
        next.assets[it.asset] = clone(doc.assets[it.asset]);
      }
    });
  });
  return next;
}

// ---------------------------------------------------------------- factories (hand-made items)

/** A new empty text box at a point (panel units). */
export function textItem({ x, y }, over = {}) {
  return {
    id: newId('text'), type: 'text', by: 'hand', x, y, w: 0.6, h: 0.12,
    font: 'body', size: 0.045, align: 'left', color: 'toner', runs: [{ text: '' }], ...over,
  };
}

/** @param {{x: number, y: number}} at top-left @param {'rect'|'ellipse'} kind */
export function shapeItem({ x, y }, kind = 'rect', over = {}) {
  return {
    id: newId('shape'), type: 'shape', by: 'hand', x, y, w: 0.3, h: 0.2,
    shape: kind, fill: 'mustard', stroke: 'toner', stroke_width: 0.006, ...over,
  };
}

/** @param {number[][]} points panel units */
export function inkItem(points, { width = 0.008, color = 'toner' } = {}) {
  return { id: newId('ink'), type: 'ink', by: 'hand', points, width, color };
}

/**
 * A photo centred on the page at up to 80% of it, keeping the image's aspect on paper.
 * @param {string} asset @param {number} w image px @param {number} h image px
 * @param {number} pageAspect panel width / panel height (mm)
 */
export function imageItem(asset, w, h, pageAspect) {
  const r = w / h;
  let iw = 0.8;
  let ih = (iw * pageAspect) / r;
  if (ih > 0.8) {
    ih = 0.8;
    iw = (ih * r) / pageAspect;
  }
  return {
    id: newId('image'), type: 'image', by: 'hand', x: (1 - iw) / 2, y: (1 - ih) / 2, w: iw, h: ih,
    asset, fit: 'cover', focus: [0.5, 0.5],
  };
}

/** @param {string} asset @param {{x?: number, y?: number}} [at] centre */
export function stickerItem(asset, { x = 0.5, y = 0.5 } = {}) {
  const w = 0.36;
  const h = 0.26;
  return { id: newId('sticker'), type: 'sticker', by: 'hand', x: x - w / 2, y: y - h / 2, w, h, asset };
}

// ---------------------------------------------------------------- helpers

function withPage(doc, index, fn) {
  return { ...doc, pages: doc.pages.map((p, i) => (i === index ? fn(p) : p)) };
}

function dropUnusedPlaceholder(doc) {
  if (!(PLACEHOLDER_ASSET in doc.assets)) return doc;
  const used = doc.pages.some((p) => p.items.some((it) => it.asset === PLACEHOLDER_ASSET));
  if (used) return doc;
  const { [PLACEHOLDER_ASSET]: _, ...assets } = doc.assets;
  return { ...doc, assets };
}
