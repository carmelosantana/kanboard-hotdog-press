// Paper sizes and margins: the single source of the sheet dimensions. Pure, no DOM.

/** @typedef {{w_mm: number, h_mm: number}} PaperSize */
/** @typedef {'a4'|'letter'} PaperId */

/** Landscape sheet sizes in mm. */
export const PAPERS = Object.freeze({
  a4: Object.freeze({ w_mm: 297, h_mm: 210 }),
  letter: Object.freeze({ w_mm: 279.4, h_mm: 215.9 }),
});

export const DEFAULT_MARGIN_MM = 6;
export const MAX_MARGIN_MM = 10;

/**
 * @param {string} id
 * @returns {PaperSize}
 */
export function paperSize(id) {
  if (!Object.hasOwn(PAPERS, id)) throw new Error(`Unknown paper: ${id}`);
  return { ...PAPERS[id] };
}

/**
 * Outer sheet margin in mm, clamped to 0..10; anything that is not a finite number becomes 6.
 * @param {unknown} mm
 * @returns {number}
 */
export function clampMargin(mm) {
  if (typeof mm !== 'number' || !Number.isFinite(mm)) return DEFAULT_MARGIN_MM;
  return Math.min(MAX_MARGIN_MM, Math.max(0, mm));
}

/**
 * @param {PaperId|PaperSize} paper an id or a size
 * @returns {PaperSize}
 */
export function resolvePaper(paper) {
  return typeof paper === 'string' ? paperSize(paper) : paper;
}

/**
 * One panel of the 4x2 grid inside the margin, in mm.
 * @param {PaperId|PaperSize} paper
 * @param {unknown} margin_mm
 * @returns {{w: number, h: number}}
 */
export function panelSize(paper, margin_mm) {
  const { w_mm, h_mm } = resolvePaper(paper);
  const m = clampMargin(margin_mm);
  return { w: (w_mm - 2 * m) / 4, h: (h_mm - 2 * m) / 2 };
}
