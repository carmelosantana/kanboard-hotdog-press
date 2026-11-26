// Ink strokes: light smoothing (a 3-point moving average) and Ramer–Douglas–Peucker simplification when a stroke ends.
// Points are [x, y] in panel units. Pure, no DOM.
import { MAX_INK_POINTS } from '../core/dog.js?v=0.1.2';

/** RDP tolerance in panel units (about a third of a millimetre on a page). */
export const SIMPLIFY_EPS = 0.003;

/**
 * Each inner point becomes the mean of itself and its two neighbours; the ends stay put.
 * @param {number[][]} pts @returns {number[][]}
 */
export function smooth(pts) {
  if (pts.length < 3) return pts.map((p) => [...p]);
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return [...p];
    const [a, b] = [pts[i - 1], pts[i + 1]];
    return [(a[0] + p[0] + b[0]) / 3, (a[1] + p[1] + b[1]) / 3];
  });
}

/**
 * Ramer–Douglas–Peucker: keeps the points that stray more than `eps` from the line between kept neighbours.
 * @param {number[][]} pts @param {number} eps @returns {number[][]}
 */
export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = /** @type {number[]} */ (stack.pop());
    let far = -1;
    let dist = eps;
    for (let i = a + 1; i < b; i++) {
      const d = lineDistance(pts[i], pts[a], pts[b]);
      if (d > dist) { dist = d; far = i; }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function lineDistance(p, a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/**
 * The stroke as stored: smoothed, simplified, rounded to 4 decimals, at most MAX_INK_POINTS points.
 * @param {number[][]} pts @returns {number[][]}
 */
export function finishStroke(pts) {
  let out = simplify(smooth(pts), SIMPLIFY_EPS);
  if (out.length > MAX_INK_POINTS) {
    const step = out.length / MAX_INK_POINTS;
    out = Array.from({ length: MAX_INK_POINTS }, (_, i) => out[Math.min(out.length - 1, Math.round(i * step))]);
    out[out.length - 1] = pts[pts.length - 1];
  }
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return out.map(([x, y]) => [r(x), r(y)]);
}
