// The 4x2 imposition: cells, panel rectangles, cut/fold guides and the per-page safe area.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cell, panelRect, guides, safeArea, SAFE_MM } from '../../Assets/js/core/impose.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} !== ${b}`);
const closeAll = (actual, expected) => {
  for (const k of Object.keys(expected)) close(actual[k], expected[k], k);
};

test('cell maps every page to its column, row and rotation', () => {
  const expected = {
    1: [3, 1, 0], 2: [3, 0, 180], 3: [2, 0, 180], 4: [1, 0, 180],
    5: [0, 0, 180], 6: [0, 1, 0], 7: [1, 1, 0], 8: [2, 1, 0],
  };
  for (const [page, [col, row, rotate]] of Object.entries(expected)) {
    assert.deepEqual(cell(Number(page)), { col, row, rotate }, `page ${page}`);
  }
});

test('cell throws outside 1..8', () => {
  for (const bad of [0, 9, -1, 1.5, '1', undefined]) {
    assert.throws(() => cell(bad), /Page must be/, String(bad));
  }
});

test('panelRect places panels inside the margin, sharing edges', () => {
  // Letter, margin 6: panel 66.85 x 101.95.
  const w = (279.4 - 12) / 4;
  const h = (215.9 - 12) / 2;
  closeAll(panelRect('letter', 6, 1), { x: 6 + 3 * w, y: 6 + h, w, h });
  assert.equal(panelRect('letter', 6, 1).rotate, 0);
  closeAll(panelRect('letter', 6, 5), { x: 6, y: 6, w, h });
  assert.equal(panelRect('letter', 6, 5).rotate, 180);
  closeAll(panelRect('letter', 6, 3), { x: 6 + 2 * w, y: 6, w, h });
  // The last column ends exactly at the right margin.
  const p2 = panelRect('letter', 6, 2);
  close(p2.x + p2.w, 279.4 - 6, 'right edge');
  close(p2.y, 6, 'top edge');
});

test('panelRect on A4 margin 0 tiles the sheet', () => {
  assert.deepEqual(panelRect('a4', 0, 7), { x: 74.25, y: 105, w: 74.25, h: 105, rotate: 0 });
});

test('guides: the cut runs along H/2 from W/4 to 3W/4', () => {
  assert.deepEqual(guides('a4', 6).cut, [297 / 4, 105, 297 * 3 / 4, 105]);
  const { cut } = guides('letter', 6);
  close(cut[0], 279.4 / 4, 'x1'); close(cut[1], 215.9 / 2, 'y1');
  close(cut[2], 279.4 * 3 / 4, 'x2'); close(cut[3], 215.9 / 2, 'y2');
});

test('guides: four folds, the full-width centre line and three full-height verticals', () => {
  const { folds } = guides('a4', 6);
  assert.equal(folds.length, 4);
  assert.deepEqual(folds, [
    [0, 105, 297, 105],
    [297 / 4, 0, 297 / 4, 210],
    [297 / 2, 0, 297 / 2, 210],
    [297 * 3 / 4, 0, 297 * 3 / 4, 210],
  ]);
});

// Letter, margin 6: panel w = 66.85, h = 101.95. Safe area is in the page's reading orientation.
const LW = (279.4 - 12) / 4;
const LH = (215.9 - 12) / 2;
const s = SAFE_MM;

test('safe area inset is 3 mm', () => {
  assert.equal(SAFE_MM, 3);
});

test('safeArea page 1 (bottom right, upright): fold on its left, centre line on its top', () => {
  // Sheet edges: left = vertical fold, right = margin, top = centre line, bottom = margin.
  closeAll(safeArea('letter', 6, 1), { x: s / LW, y: s / LH, w: 1 - s / LW, h: 1 - s / LH });
});

test('safeArea page 5 (top left, rotated 180): sheet edges flip into its reading frame', () => {
  // Sheet edges: left = margin, right = fold, top = margin, bottom = centre line.
  // Rotated 180, the sheet-right fold is its reading left, the centre line its reading top.
  closeAll(safeArea('letter', 6, 5), { x: s / LW, y: s / LH, w: 1 - s / LW, h: 1 - s / LH });
});

test('safeArea page 6 (bottom left, upright): fold on its right, centre line on its top', () => {
  closeAll(safeArea('letter', 6, 6), { x: 0, y: s / LH, w: 1 - s / LW, h: 1 - s / LH });
});

test('safeArea page 2 (top right, rotated 180): sheet-left fold becomes its reading right', () => {
  closeAll(safeArea('letter', 6, 2), { x: 0, y: s / LH, w: 1 - s / LW, h: 1 - s / LH });
});

test('safeArea inner pages 3 and 7: folds on both sides', () => {
  const inner = { x: s / LW, y: s / LH, w: 1 - 2 * s / LW, h: 1 - s / LH };
  closeAll(safeArea('letter', 6, 3), inner);
  closeAll(safeArea('letter', 6, 7), inner);
});

test('safeArea: every page keeps its reading bottom at the sheet margin', () => {
  for (let page = 1; page <= 8; page++) {
    const a = safeArea('letter', 6, page);
    close(a.y + a.h, 1, `page ${page} bottom`);
  }
});
