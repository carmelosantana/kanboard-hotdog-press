// Paper sizes, margin clamping and panel size: the exact values from the Global Constraints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paperSize, clampMargin, panelSize, PAPERS } from '../../Assets/js/core/paper.js';

test('paperSize returns the landscape sizes in mm', () => {
  assert.deepEqual(paperSize('a4'), { w_mm: 297, h_mm: 210 });
  assert.deepEqual(paperSize('letter'), { w_mm: 279.4, h_mm: 215.9 });
  assert.deepEqual(Object.keys(PAPERS).sort(), ['a4', 'letter']);
});

test('paperSize returns a copy, so callers cannot change the table', () => {
  paperSize('a4').w_mm = 1;
  assert.equal(paperSize('a4').w_mm, 297);
});

test('paperSize throws on an unknown id', () => {
  assert.throws(() => paperSize('legal'), /Unknown paper/);
  assert.throws(() => paperSize(undefined), /Unknown paper/);
  assert.throws(() => paperSize('toString'), /Unknown paper/);
});

test('clampMargin keeps 0..10 and defaults non-numbers to 6', () => {
  assert.equal(clampMargin(6), 6);
  assert.equal(clampMargin(0), 0);
  assert.equal(clampMargin(10), 10);
  assert.equal(clampMargin(2.5), 2.5);
  assert.equal(clampMargin(-3), 0);
  assert.equal(clampMargin(42), 10);
  assert.equal(clampMargin('8'), 6);
  assert.equal(clampMargin(undefined), 6);
  assert.equal(clampMargin(null), 6);
  assert.equal(clampMargin(NaN), 6);
  assert.equal(clampMargin(Infinity), 6);
});

test('panelSize is the physical page: (W / 4, H / 2)', () => {
  assert.deepEqual(panelSize('a4'), { w: 74.25, h: 105 });
  assert.deepEqual(panelSize('letter'), { w: 279.4 / 4, h: 215.9 / 2 });
  assert.deepEqual(panelSize({ w_mm: 297, h_mm: 210 }), { w: 74.25, h: 105 });
});

test('panel aspect h/w: A4 is root 2, Letter is 1.545', () => {
  const a4 = panelSize('a4');
  const letter = panelSize('letter');
  assert.equal((a4.h / a4.w).toFixed(3), '1.414');
  assert.equal((letter.h / letter.w).toFixed(3), '1.545');
});
