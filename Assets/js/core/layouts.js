// Layouts: each layout's named slots and where they sit, plus character budgets. Pure, no DOM.
// Layouts own all slot geometry: boxes are fractions of a page's safe area, so nothing is placed off it.
import { LAYOUT_NAMES, randomId } from './dog.js';
import { safeArea } from './impose.js';
import { panelSize } from './paper.js';

/** @typedef {import('./impose.js').Paper} Paper */
/** @typedef {'text'|'list'|'image'} SlotKind */
/**
 * box: [x, y, w, h] as fractions of the safe area. size: font size in panel-height units (text and list only).
 * @typedef {{name: string, kind: SlotKind, box: number[], font?: string, size?: number, align?: string}} Slot
 */
/** @typedef {{text?: string, asset?: string, items?: string[], by?: string}} SlotFill */
/** @typedef {{margin_mm?: number, page?: number}} PlaceOpts */

/**
 * Smallest font size any slot may use, in panel-height units (0.024 × ~105 mm ≈ 2.5 mm ≈ 7 pt).
 * Placeholder until the print probe is read.
 */
export const MIN_FONT_SIZE = 0.024;
/** Average glyph width as a fraction of the font size (em), for budgets: 0.5 em suits proportional faces. */
export const GLYPH_EM = 0.5;
/** Line height as a multiple of the font size, for budgets. */
export const LINE_HEIGHT = 1.2;
export const BULLET = '•';

const text = (name, box, font, size, align = 'left') => ({ name, kind: 'text', box, font, size, align });
const list = (name, box, size) => ({ name, kind: 'list', box, font: 'body', size, align: 'left' });
const image = (name, box) => ({ name, kind: 'image', box });

/** @type {Record<string, Slot[]>} */
const SLOTS = {
  cover: [
    text('title', [0, 0, 1, 0.26], 'display', 0.09),
    text('subtitle', [0, 0.28, 1, 0.1], 'body', 0.04),
    image('photo', [0, 0.4, 1, 0.6]),
  ],
  'back-cover': [
    text('body', [0, 0, 1, 0.7], 'body', 0.035),
    text('note', [0, 0.76, 1, 0.24], 'mono', 0.028),
  ],
  'headline-body': [
    text('title', [0, 0, 1, 0.22], 'display', 0.075),
    text('body', [0, 0.25, 1, 0.75], 'body', 0.035),
  ],
  'photo-full': [
    image('photo', [0, 0, 1, 0.86]),
    text('caption', [0, 0.88, 1, 0.12], 'body', 0.03),
  ],
  'photo-caption': [
    text('title', [0, 0, 1, 0.16], 'display', 0.06),
    image('photo', [0, 0.18, 1, 0.5]),
    text('body', [0, 0.7, 1, 0.3], 'body', 0.032),
  ],
  list: [
    text('title', [0, 0, 1, 0.18], 'display', 0.065),
    list('list', [0, 0.21, 1, 0.79], 0.038),
  ],
  quote: [
    text('quote', [0, 0.15, 1, 0.55], 'display', 0.06, 'center'),
    text('attribution', [0, 0.74, 1, 0.1], 'mono', 0.03, 'right'),
  ],
  'two-up': [
    text('title', [0, 0, 1, 0.14], 'display', 0.055),
    image('photo', [0, 0.16, 0.48, 0.4]),
    image('photo2', [0.52, 0.16, 0.48, 0.4]),
    text('body', [0, 0.6, 1, 0.4], 'body', 0.03),
  ],
  freeform: [],
};

/** The nine layouts, keyed in LAYOUT_NAMES order. */
export const LAYOUTS = Object.freeze(Object.fromEntries(LAYOUT_NAMES.map((name) => {
  if (!SLOTS[name]) throw new Error(`Layout without slots: ${name}`);
  return [name, Object.freeze({ slots: Object.freeze(SLOTS[name].map((s) => Object.freeze(s))) })];
})));

/**
 * Dog items for the filled slots, in slot order, inside the page's safe area (panel units, reading orientation).
 * Without a page the boxes sit inside every page's safe area. Unfilled (absent or null) slots are left out; text is not
 * truncated. Every item gets a fresh id.
 * @param {string} layout
 * @param {Record<string, SlotFill>} slots
 * @param {Paper} paper
 * @param {PlaceOpts} [opts]
 */
export function place(layout, slots, paper, { margin_mm = 6, page } = {}) {
  const defs = slotsOf(layout);
  for (const name of Object.keys(slots)) slotOf(layout, name);
  const area = areaFor(paper, margin_mm, page);
  return defs.filter((s) => slots[s.name] != null).map((s) => {
    const fill = slots[s.name];
    const base = { id: `${s.name}_${randomId()}`, slot: s.name, by: fill.by ?? 'hand', ...boxIn(area, s.box) };
    if (s.kind === 'image') return { ...base, type: 'image', asset: fill.asset, fit: 'cover', focus: [0.5, 0.5] };
    const runs = s.kind === 'list'
      ? (fill.items ?? []).map((line) => ({ text: `${BULLET} ${line}` }))
      : [{ text: fill.text ?? '' }];
    return { ...base, type: 'text', font: s.font, size: s.size, align: s.align, color: 'toner', runs };
  });
}

/**
 * The most characters a text slot holds at its font size: characters per line (box width / (GLYPH_EM × font))
 * times lines (box height / (LINE_HEIGHT × font)). Image slots hold 0.
 * @param {string} layout
 * @param {string} slot
 * @param {Paper} paper
 * @param {PlaceOpts} [opts]
 * @returns {number}
 */
export function budget(layout, slot, paper, { margin_mm = 6, page } = {}) {
  const s = slotOf(layout, slot);
  if (s.kind === 'image') return 0;
  const { w, h } = panelSize(paper);
  const box = boxIn(areaFor(paper, margin_mm, page), s.box);
  const font = s.size * h;
  const perLine = Math.floor((box.w * w) / (GLYPH_EM * font));
  const lines = Math.floor((box.h * h) / (LINE_HEIGHT * font));
  return perLine * lines;
}

function slotsOf(layout) {
  if (!Object.hasOwn(LAYOUTS, layout)) throw new Error(`Unknown layout: ${layout}`);
  return LAYOUTS[layout].slots;
}

function slotOf(layout, name) {
  const s = slotsOf(layout).find((d) => d.name === name);
  if (!s) throw new Error(`Unknown slot ${name} for layout ${layout}`);
  return s;
}

/** The page's safe area, or the part common to all eight pages' safe areas when no page is given. */
function areaFor(paper, margin_mm, page) {
  if (page !== undefined) return safeArea(paper, margin_mm, page);
  const all = Array.from({ length: 8 }, (_, i) => safeArea(paper, margin_mm, i + 1));
  const x = Math.max(...all.map((a) => a.x));
  const y = Math.max(...all.map((a) => a.y));
  return {
    x,
    y,
    w: Math.min(...all.map((a) => a.x + a.w)) - x,
    h: Math.min(...all.map((a) => a.y + a.h)) - y,
  };
}

function boxIn(area, [bx, by, bw, bh]) {
  return { x: area.x + bx * area.w, y: area.y + by * area.h, w: bw * area.w, h: bh * area.h };
}
