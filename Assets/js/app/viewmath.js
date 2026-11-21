// Small view sums for the editor: fitting a page into a box, the page strip's drop slot, the booklet's spreads and the
// photo downscale before upload. Pure, no DOM.

/** Photos are downscaled to at most this many px on the long edge before upload. */
export const UPLOAD_MAX_PX = 1300;

/** Reading order of the folded booklet: the cover alone, three spreads, the back cover alone (page indexes). */
export const SPREADS = Object.freeze([[0], [1, 2], [3, 4], [5, 6], [7]].map((s) => Object.freeze(s)));

/**
 * The largest size with aspect w:h inside maxW × maxH (whole px).
 * @returns {{w: number, h: number}}
 */
export function fitInto(w, h, maxW, maxH) {
  if (!(w > 0 && h > 0 && maxW > 0 && maxH > 0)) return { w: 0, h: 0 };
  const k = Math.min(maxW / w, maxH / h);
  return { w: Math.floor(w * k), h: Math.floor(h * k) };
}

/**
 * The slot index whose centre is nearest to `x` along the strip.
 * @param {number} x @param {number[]} centres
 */
export function dropIndex(x, centres) {
  let best = 0;
  centres.forEach((c, i) => { if (Math.abs(x - c) < Math.abs(x - centres[best])) best = i; });
  return best;
}

/**
 * Image size after the upload downscale (never upscaled).
 * @returns {{w: number, h: number}}
 */
export function downscale(w, h, max = UPLOAD_MAX_PX) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}
