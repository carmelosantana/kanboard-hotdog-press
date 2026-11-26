// The 4x2 one-sheet imposition: where each page sits, the cut and folds, and each page's safe area. Pure, no DOM.
import { clampMargin, panelSize, resolvePaper } from './paper.js?v=0.1.2';

/** @typedef {import('./paper.js').PaperId|import('./paper.js').PaperSize} Paper */

export const COLS = 4;
export const ROWS = 2;
/** Inset in mm on every panel edge that touches a fold or the cut line. */
export const SAFE_MM = 3;

/** Page 1..8 -> [col, row, rotate]; row 0 is the top row, which prints upside down. */
const CELLS = [
  [3, 1, 0], [3, 0, 180], [2, 0, 180], [1, 0, 180],
  [0, 0, 180], [0, 1, 0], [1, 1, 0], [2, 1, 0],
];

/**
 * @param {number} page 1..8
 * @returns {{col: number, row: number, rotate: 0|180}}
 */
export function cell(page) {
  if (!Number.isInteger(page) || page < 1 || page > 8) throw new Error(`Page must be 1..8, got ${page}`);
  const [col, row, rotate] = CELLS[page - 1];
  return { col, row, rotate: /** @type {0|180} */ (rotate) };
}

/**
 * The page's physical panel on the sheet, mm from the top-left corner.
 * @param {Paper} paper
 * @param {number} page
 * @returns {{x: number, y: number, w: number, h: number, rotate: 0|180}}
 */
export function panelRect(paper, page) {
  const { col, row, rotate } = cell(page);
  const { w, h } = panelSize(paper);
  return { x: col * w, y: row * h, w, h, rotate };
}

/**
 * A point in page `page`'s reading orientation, mm from its reading top-left, as sheet mm from the sheet's top-left
 * (an upside-down page turns it about the panel's centre).
 * @param {Paper} paper
 * @param {number} page
 * @param {number} x
 * @param {number} y
 * @returns {[number, number]}
 */
export function readingToSheet(paper, page, x, y) {
  const r = panelRect(paper, page);
  return r.rotate === 180 ? [r.x + r.w - x, r.y + r.h - y] : [r.x + x, r.y + y];
}

/**
 * Cut and fold lines in sheet mm, each [x1, y1, x2, y2]. They lie on panel edges.
 * @param {Paper} paper
 * @returns {{cut: number[], folds: number[][]}}
 */
export function guides(paper) {
  const { w_mm: W, h_mm: H } = resolvePaper(paper);
  return {
    cut: [W / 4, H / 2, (3 * W) / 4, H / 2],
    folds: [
      [0, H / 2, W, H / 2],
      [W / 4, 0, W / 4, H],
      [W / 2, 0, W / 2, H],
      [(3 * W) / 4, 0, (3 * W) / 4, H],
    ],
  };
}

/**
 * The area to keep content in, in panel units (0..1) and the page's own reading orientation.
 * Edges at the sheet edge get the margin (clamped); edges on a fold or the cut get SAFE_MM.
 * @param {Paper} paper
 * @param {unknown} margin_mm
 * @param {number} page
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function safeArea(paper, margin_mm, page) {
  const { col, row, rotate } = cell(page);
  const { w, h } = panelSize(paper);
  const m = clampMargin(margin_mm);
  // Insets in sheet orientation.
  const sheet = {
    left: col === 0 ? m : SAFE_MM,
    right: col === COLS - 1 ? m : SAFE_MM,
    top: row === 0 ? m : SAFE_MM,
    bottom: row === ROWS - 1 ? m : SAFE_MM,
  };
  // A 180 degree turn swaps top with bottom and left with right.
  const r = rotate === 180
    ? { left: sheet.right, right: sheet.left, top: sheet.bottom, bottom: sheet.top }
    : sheet;
  return {
    x: r.left / w,
    y: r.top / h,
    w: 1 - (r.left + r.right) / w,
    h: 1 - (r.top + r.bottom) / h,
  };
}
