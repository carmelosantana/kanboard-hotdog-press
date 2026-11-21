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

// Letter: panel w = 69.85, h = 107.95.
const LW = 279.4 / 4;
const LH = 215.9 / 2;

test('panelRect is the physical quarter-by-half of the sheet', () => {
  closeAll(panelRect('letter', 1), { x: 3 * LW, y: LH, w: LW, h: LH });
  assert.equal(panelRect('letter', 1).rotate, 0);
  closeAll(panelRect('letter', 5), { x: 0, y: 0, w: LW, h: LH });
  assert.equal(panelRect('letter', 5).rotate, 180);
  closeAll(panelRect('letter', 3), { x: 2 * LW, y: 0, w: LW, h: LH });
  const p2 = panelRect('letter', 2);
  close(p2.x + p2.w, 279.4, 'right edge');
  assert.deepEqual(panelRect('a4', 7), { x: 74.25, y: 105, w: 74.25, h: 105, rotate: 0 });
});

test('guides: the cut runs along H/2 from W/4 to 3W/4', () => {
  assert.deepEqual(guides('a4').cut, [297 / 4, 105, 297 * 3 / 4, 105]);
  const { cut } = guides('letter');
  close(cut[0], 279.4 / 4, 'x1'); close(cut[1], 215.9 / 2, 'y1');
  close(cut[2], 279.4 * 3 / 4, 'x2'); close(cut[3], 215.9 / 2, 'y2');
});

test('guides: four folds, the full-width centre line and three full-height verticals', () => {
  const { folds } = guides('a4');
  assert.equal(folds.length, 4);
  assert.deepEqual(folds, [
    [0, 105, 297, 105],
    [297 / 4, 0, 297 / 4, 210],
    [297 / 2, 0, 297 / 2, 210],
    [297 * 3 / 4, 0, 297 * 3 / 4, 210],
  ]);
});

test('guides coincide with panel edges: every fold and the cut lie on a shared panel edge', () => {
  for (const paper of ['a4', 'letter']) {
    const { cut, folds } = guides(paper);
    const xs = new Set();
    const ys = new Set();
    for (let page = 1; page <= 8; page++) {
      const r = panelRect(paper, page);
      xs.add(r.x); xs.add(r.x + r.w);
      ys.add(r.y); ys.add(r.y + r.h);
    }
    const onX = (x) => [...xs].some((e) => Math.abs(e - x) < 1e-9);
    const onY = (y) => [...ys].some((e) => Math.abs(e - y) < 1e-9);
    const [hz, ...verticals] = folds;
    assert.ok(onY(hz[1]) && onY(hz[3]), `${paper} centre fold`);
    for (const v of verticals) assert.ok(onX(v[0]) && onX(v[2]), `${paper} fold at ${v[0]}`);
    assert.ok(onY(cut[1]) && onX(cut[0]) && onX(cut[2]), `${paper} cut`);
  }
});

// Safe area on Letter, margin 6, in the page's reading orientation: margin at the sheet edge, 3 mm at folds/cut.
const s = SAFE_MM;
const m = 6;

test('safe area inset is 3 mm', () => {
  assert.equal(SAFE_MM, 3);
});

test('safeArea page 1 (bottom right, upright): fold left, centre line top, sheet edge right and bottom', () => {
  closeAll(safeArea('letter', m, 1), { x: s / LW, y: s / LH, w: 1 - (s + m) / LW, h: 1 - (s + m) / LH });
});

test('safeArea page 5 (top left, rotated 180): sheet edges flip into its reading frame', () => {
  // Sheet: left = edge, right = fold, top = edge, bottom = centre line. Turned 180: reading left = fold, top = centre.
  closeAll(safeArea('letter', m, 5), { x: s / LW, y: s / LH, w: 1 - (s + m) / LW, h: 1 - (s + m) / LH });
});

test('safeArea page 6 (bottom left, upright): sheet edge left, fold right', () => {
  closeAll(safeArea('letter', m, 6), { x: m / LW, y: s / LH, w: 1 - (m + s) / LW, h: 1 - (s + m) / LH });
});

test('safeArea page 2 (top right, rotated 180): sheet-right edge becomes its reading left', () => {
  closeAll(safeArea('letter', m, 2), { x: m / LW, y: s / LH, w: 1 - (m + s) / LW, h: 1 - (s + m) / LH });
});

test('safeArea inner pages 3 and 7: folds on both sides', () => {
  const inner = { x: s / LW, y: s / LH, w: 1 - 2 * s / LW, h: 1 - (s + m) / LH };
  closeAll(safeArea('letter', m, 3), inner);
  closeAll(safeArea('letter', m, 7), inner);
});

test('safeArea: every page has 3 mm at its reading top and the margin at its reading bottom', () => {
  for (let page = 1; page <= 8; page++) {
    const a = safeArea('letter', m, page);
    close(a.y, s / LH, `page ${page} top`);
    close(a.y + a.h, 1 - m / LH, `page ${page} bottom`);
  }
});

test('safeArea clamps the margin: 0 leaves sheet edges uninset, a bad value means 6', () => {
  closeAll(safeArea('letter', 0, 6), { x: 0, y: s / LH, w: 1 - s / LW, h: 1 - s / LH });
  assert.deepEqual(safeArea('letter', 'x', 6), safeArea('letter', 6, 6));
  assert.deepEqual(safeArea('letter', 50, 6), safeArea('letter', 10, 6));
});
