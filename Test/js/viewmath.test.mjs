// Small view sums: fitting a page into a box, the strip's drop slot, booklet spreads and the photo downscale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitInto, dropIndex, SPREADS, downscale, UPLOAD_MAX_PX } from '../../Assets/js/app/viewmath.js';

test('fitInto scales a w:h shape to the largest size inside a box', () => {
  assert.deepEqual(fitInto(1, 2, 400, 400), { w: 200, h: 400 });
  assert.deepEqual(fitInto(2, 1, 400, 400), { w: 400, h: 200 });
  assert.deepEqual(fitInto(1, 1, 0, 100), { w: 0, h: 0 });
});

test('dropIndex picks the slot whose centre is nearest along the strip', () => {
  const centres = [50, 150, 250, 350];
  assert.equal(dropIndex(10, centres), 0);
  assert.equal(dropIndex(160, centres), 1);
  assert.equal(dropIndex(990, centres), 3);
});

test('booklet spreads: the cover alone, three spreads, the back cover alone', () => {
  assert.deepEqual(SPREADS, [[0], [1, 2], [3, 4], [5, 6], [7]]);
});

test('downscale keeps images at or under 1300 px on the long edge, with their aspect', () => {
  assert.equal(UPLOAD_MAX_PX, 1300);
  assert.deepEqual(downscale(4000, 3000), { w: 1300, h: 975 });
  assert.deepEqual(downscale(1000, 2600), { w: 500, h: 1300 });
  assert.deepEqual(downscale(800, 600), { w: 800, h: 600 });
});
