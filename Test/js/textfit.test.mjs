// Text fitting shared by the renderer and the layout budgets: the bundled fonts' measured metrics, how many lines a
// box holds, and greedy word wrapping.
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  FONT_METRICS, FONT_SOURCES, LINE_HEIGHT, metricsOf, linesThatFit, blockHeight, wrapText,
} from '../../Assets/js/core/textfit.js';
import { LINE_HEIGHT as LAYOUT_LINE_HEIGHT } from '../../Assets/js/core/layouts.js';

test('metrics for the three font roles, measured from the bundled fonts (Test/tools/font-metrics.mjs)', () => {
  assert.deepEqual(Object.keys(FONT_METRICS).sort(), ['body', 'display', 'mono']);
  // Anton's accented capitals rise well above its em box: the clipped "Aún" of the first sample run.
  assert.ok(FONT_METRICS.display.ascent > 1.2, 'Anton accents reach above 1.2 em');
  assert.equal(FONT_METRICS.mono.glyph, 0.6, 'Courier Prime advances 0.6 em');
  for (const m of Object.values(FONT_METRICS)) {
    for (const k of ['ascent', 'descent', 'glyph']) assert.ok(m[k] > 0 && m[k] < 2, k);
  }
  assert.equal(metricsOf('nope'), FONT_METRICS.body, 'an unknown role falls back to body, as the fonts do');
  assert.equal(LINE_HEIGHT, LAYOUT_LINE_HEIGHT, 'one line height for layouts and renderer');
});

test('linesThatFit: the first line needs ascent + descent, each further line one line height', () => {
  const { ascent, descent } = FONT_METRICS.display;
  const size = 10;
  const first = (ascent + descent) * size;
  assert.equal(linesThatFit(first - 0.01, size, 'display'), 0);
  assert.equal(linesThatFit(first, size, 'display'), 1);
  assert.equal(linesThatFit(first + LINE_HEIGHT * size, size, 'display'), 2);
  assert.equal(linesThatFit(first + LINE_HEIGHT * size - 0.01, size, 'display'), 1);
  assert.equal(linesThatFit(100, 0, 'display'), 0);
  for (const n of [1, 2, 5]) assert.equal(linesThatFit(blockHeight(n, size, 'body'), size, 'body'), n, `${n} lines`);
});

test('wrapText wraps greedily by words, breaks newlines, splits over-long words, ends on a too-narrow box', () => {
  const fits = (s) => [...s].length <= 13;
  assert.deepEqual(wrapText('one two three four five\nsix', fits), ['one two three', 'four five', 'six']);
  assert.deepEqual(wrapText('abcdefghijklmnopqrstuvwxyz ok', fits), ['abcdefghijklm', 'nopqrstuvwxyz', 'ok']);
  assert.deepEqual(wrapText('', fits), []);
  assert.ok(wrapText('ab cd', () => false).length > 0);
});

test('the metrics were measured from exactly the bundled font files (re-run font-metrics.mjs when one changes)', () => {
  assert.deepEqual(Object.keys(FONT_SOURCES).sort(), Object.keys(FONT_METRICS).sort());
  for (const [role, { file, sha256 }] of Object.entries(FONT_SOURCES)) {
    const bytes = readFileSync(new URL(`../../Assets/fonts/${file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, `${role}: ${file} changed since its metrics were measured`);
  }
});
