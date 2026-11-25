// Editor geometry: item boxes in panel units, and hit-testing, handles, resize and rotate in view px (x right, y down,
// rot in degrees clockwise about the box centre, as render.js draws it). Pure, no DOM.
import { MIN_UNIT, MAX_UNIT } from '../core/dog.js?v=0.1.1';

/** @typedef {{x: number, y: number, w: number, h: number, rot: number}} Box */
/** @typedef {{x: number, y: number}} Point */
/** @typedef {'nw'|'ne'|'se'|'sw'|'rot'} Handle */

/** Smallest box side while resizing, in view px. */
export const MIN_PX = 8;
/** How far above the top edge the rotate handle sits, in view px. */
export const ROT_OFFSET = 28;
const CORNERS = /** @type {const} */ ({ nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] });
const OPPOSITE = /** @type {const} */ ({ nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' });

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clampUnit = (v) => Math.min(MAX_UNIT, Math.max(MIN_UNIT, v));
const inkPoints = (item) => (Array.isArray(item.points) ? item.points : []);

/**
 * The item's box in panel units; an ink stroke without a box gets the bounds of its points.
 * @returns {Box}
 */
export function itemBox(item) {
  if (item.type === 'ink' && item.x === undefined) {
    const pts = inkPoints(item);
    if (!pts.length) return { x: 0, y: 0, w: 0, h: 0, rot: num(item.rot) };
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, rot: num(item.rot) };
  }
  return { x: num(item.x), y: num(item.y), w: num(item.w), h: num(item.h), rot: num(item.rot) };
}

/** @param {Box} b panel units @returns {Box} view px */
export const toPx = (b, W, H) => ({ x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H, rot: b.rot });
/** @param {Box} b view px @returns {Box} panel units */
export const toUnits = (b, W, H) => ({ x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H, rot: b.rot });

const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
function turn(v, deg) {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}
/** A view point in the box's own unrotated frame, relative to its centre. */
const local = (b, p) => { const c = centre(b); return turn({ x: p.x - c.x, y: p.y - c.y }, -b.rot); };

/**
 * The topmost item under a view point (later items draw on top). Ink is hit near its line only.
 * @param {any[]} items @param {Point} p view px @param {number} W @param {number} H @param {number} [tol] px
 * @returns {string|null}
 */
export function hitTest(items, p, W, H, tol = 6) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const b = toPx(itemBox(it), W, H);
    if (it.type === 'ink') {
      const q = b.rot ? turn({ x: p.x - centre(b).x, y: p.y - centre(b).y }, -b.rot) : null;
      const pt = q ? { x: q.x + centre(b).x, y: q.y + centre(b).y } : p;
      const pts = inkPoints(it).map(([x, y]) => ({ x: x * W, y: y * H }));
      const reach = (num(it.width, 0.006) * W) / 2 + tol;
      for (let k = 0; k < pts.length; k++) {
        if (segmentDistance(pt, pts[k], pts[Math.min(k + 1, pts.length - 1)]) <= reach) return it.id;
      }
      continue;
    }
    const l = local(b, p);
    if (Math.abs(l.x) <= b.w / 2 + tol && Math.abs(l.y) <= b.h / 2 + tol) return it.id;
  }
  return null;
}

function segmentDistance(p, a, b) {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The four corner handles and the rotate handle of a view box, where they are drawn.
 * @param {Box} b @returns {Record<Handle, Point>}
 */
export function handlePoints(b) {
  const c = centre(b);
  const at = (v) => { const t = turn(v, b.rot); return { x: c.x + t.x, y: c.y + t.y }; };
  const out = /** @type {Record<Handle, Point>} */ ({});
  for (const [name, [sx, sy]] of Object.entries(CORNERS)) out[name] = at({ x: (sx * b.w) / 2, y: (sy * b.h) / 2 });
  out.rot = at({ x: 0, y: -b.h / 2 - ROT_OFFSET });
  return out;
}

/** @param {Box} b @param {Point} p @param {number} radius px @returns {Handle|null} */
export function handleAt(b, p, radius) {
  for (const [name, q] of Object.entries(handlePoints(b))) {
    if (Math.hypot(p.x - q.x, p.y - q.y) <= radius) return /** @type {Handle} */ (name);
  }
  return null;
}

/**
 * A move by (dx, dy) panel units as an item patch: x/y, or every ink point.
 * @returns {object}
 */
export function moveBy(item, dx, dy) {
  if (item.type === 'ink' && item.x === undefined) {
    return { points: inkPoints(item).map(([x, y]) => [clampUnit(x + dx), clampUnit(y + dy)]) };
  }
  return { x: clampUnit(num(item.x) + dx), y: clampUnit(num(item.y) + dy) };
}

/**
 * Drag a corner handle to `p`: the opposite corner stays where it is drawn, the sides follow the box's own turn.
 * @param {Box} b view px @param {'nw'|'ne'|'se'|'sw'} handle @param {Point} p @returns {Box}
 */
export function resizeBox(b, handle, p) {
  const [sx, sy] = CORNERS[handle];
  const anchor = handlePoints(b)[OPPOSITE[handle]];
  const v = turn({ x: p.x - anchor.x, y: p.y - anchor.y }, -b.rot);
  const w = Math.max(MIN_PX, sx * v.x);
  const h = Math.max(MIN_PX, sy * v.y);
  const off = turn({ x: (sx * w) / 2, y: (sy * h) / 2 }, b.rot);
  const c = { x: anchor.x + off.x, y: anchor.y + off.y };
  return { x: c.x - w / 2, y: c.y - h / 2, w, h, rot: b.rot };
}

/**
 * The turn (0..360 degrees clockwise) that points the box's top at `p`; `snap` rounds to 15° steps.
 * @param {Box} b @param {Point} p @param {boolean} [snap]
 */
export function rotateTo(b, p, snap = false) {
  const c = centre(b);
  let deg = (Math.atan2(p.x - c.x, -(p.y - c.y)) * 180) / Math.PI;
  if (snap) deg = Math.round(deg / 15) * 15;
  return ((deg % 360) + 360) % 360;
}

/**
 * A box in panel units written back as an item patch, inside the validator's ranges. Ink keeps no box: its points
 * are scaled from their old bounds into the new one.
 * @param {any} item @param {Box} b panel units
 */
export function boxPatch(item, b) {
  const rot = Math.round(b.rot * 100) / 100;
  if (item.type === 'ink' && item.x === undefined) {
    const old = itemBox(item);
    const kx = old.w > 0 ? b.w / old.w : 1;
    const ky = old.h > 0 ? b.h / old.h : 1;
    const points = inkPoints(item).map(([x, y]) => [clampUnit(b.x + (x - old.x) * kx), clampUnit(b.y + (y - old.y) * ky)]);
    return rot || item.rot !== undefined ? { points, rot } : { points };
  }
  const side = (v) => Math.min(MAX_UNIT, Math.max(0.001, v));
  return { x: clampUnit(b.x), y: clampUnit(b.y), w: side(b.w), h: side(b.h), rot };
}
