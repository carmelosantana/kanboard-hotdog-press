// Filters on ImageData-like objects: luminance grayscale and levels, in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { luminance, toGray, levels } from '../../Assets/js/core/filters.js';

/** A plain ImageData-like object from [r, g, b, a] pixels. */
const image = (...px) => ({ width: px.length, height: 1, data: new Uint8ClampedArray(px.flat()) });

test('luminance weighs green most, then red, then blue (Rec. 601)', () => {
  assert.equal(luminance(255, 0, 0), 76);
  assert.equal(luminance(0, 255, 0), 150);
  assert.equal(luminance(0, 0, 255), 29);
  assert.equal(luminance(255, 255, 255), 255);
  assert.equal(luminance(0, 0, 0), 0);
});

test('toGray sets r = g = b = luminance in place, keeps alpha, returns the same object', () => {
  const img = image([255, 0, 0, 255], [0, 255, 0, 128], [232, 181, 23, 0]);
  const out = toGray(img);
  assert.equal(out, img);
  assert.deepEqual([...img.data], [
    76, 76, 76, 255,
    150, 150, 150, 128,
    luminance(232, 181, 23), luminance(232, 181, 23), luminance(232, 181, 23), 0,
  ]);
});

test('levels maps black..white onto 0..255 per channel, clamps outside, keeps alpha', () => {
  const img = image([50, 100, 150, 255], [200, 20, 250, 7]);
  const out = levels(img, 50, 150);
  assert.equal(out, img);
  assert.deepEqual([...img.data], [0, 128, 255, 255, 255, 0, 255, 7]);
});

test('levels with 0..255 changes nothing', () => {
  const img = image([1, 2, 3, 4], [254, 128, 0, 255]);
  levels(img, 0, 255);
  assert.deepEqual([...img.data], [1, 2, 3, 4, 254, 128, 0, 255]);
});

test('levels refuses a range where white is not above black', () => {
  for (const [b, w] of [[100, 100], [200, 100], [-1, 255], [0, 256], [NaN, 255]]) {
    assert.throws(() => levels(image([0, 0, 0, 255]), b, w), RangeError, `${b}..${w}`);
  }
});
