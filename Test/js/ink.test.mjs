// Ink strokes: light smoothing and simplification on stroke end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smooth, simplify, finishStroke } from '../../Assets/js/app/ink.js';
import { MAX_INK_POINTS } from '../../Assets/js/core/dog.js';

test('smooth averages each point with its neighbours and keeps both ends', () => {
  const out = smooth([[0, 0], [1, 3], [2, 0], [3, 3], [4, 0]]);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out[4], [4, 0]);
  assert.deepEqual(out[2], [2, 2]);
  assert.deepEqual(smooth([[1, 1]]), [[1, 1]]);
});

test('simplify drops points that lie on a straight line within the tolerance', () => {
  const line = Array.from({ length: 50 }, (_, i) => [i / 49, i / 49 + (i % 2 ? 0.0001 : 0)]);
  const out = simplify(line, 0.002);
  assert.deepEqual(out, [line[0], line[49]]);
  const corner = [[0, 0], [0.5, 0], [0.5, 0.5]];
  assert.deepEqual(simplify(corner, 0.002), corner);
});

test('finishStroke smooths, simplifies, rounds to 4 decimals and caps the point count', () => {
  const wobbly = Array.from({ length: 200 }, (_, i) => [i / 199, 0.5 + Math.sin(i / 10) * 0.2 + (i % 2) * 0.0005]);
  const out = finishStroke(wobbly);
  assert.ok(out.length < wobbly.length);
  assert.ok(out.length >= 2);
  for (const [x, y] of out) {
    assert.equal(x, Math.round(x * 1e4) / 1e4);
    assert.equal(y, Math.round(y * 1e4) / 1e4);
  }
  const huge = Array.from({ length: MAX_INK_POINTS * 3 }, (_, i) => [Math.random(), Math.random()]);
  assert.ok(finishStroke(huge).length <= MAX_INK_POINTS);
  assert.deepEqual(finishStroke([[0.123456, 0.5]]), [[0.1235, 0.5]], 'a tap is a dot');
});
