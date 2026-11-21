// Editor geometry: item boxes, hit-testing, handles, move, resize and rotate (view px, rotation-aware).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  itemBox, toPx, hitTest, handleAt, handlePoints, moveBy, resizeBox, rotateTo, boxPatch, MIN_PX,
} from '../../Assets/js/app/geometry.js';

const W = 400;
const H = 600;
const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} !== ${b}`);
const rect = (id, over = {}) => ({ id, type: 'shape', by: 'hand', x: 0.25, y: 0.25, w: 0.5, h: 0.5, ...over });

test('itemBox reads a box, and an ink stroke gets the bounds of its points', () => {
  assert.deepEqual(itemBox(rect('a', { rot: 30 })), { x: 0.25, y: 0.25, w: 0.5, h: 0.5, rot: 30 });
  const ink = { id: 'i', type: 'ink', points: [[0.1, 0.2], [0.3, 0.6], [0.2, 0.4]] };
  const b = itemBox(ink);
  close(b.x, 0.1, 'x'); close(b.y, 0.2, 'y'); close(b.w, 0.2, 'w'); close(b.h, 0.4, 'h');
  assert.deepEqual(toPx({ x: 0.5, y: 0.5, w: 0.25, h: 0.1, rot: 0 }, W, H), { x: 200, y: 300, w: 100, h: 60, rot: 0 });
});

test('hitTest finds the topmost item, honours rotation, and finds ink near its line only', () => {
  const items = [rect('under'), rect('over', { x: 0.4, y: 0.4, w: 0.2, h: 0.2 })];
  assert.equal(hitTest(items, { x: 200, y: 300 }, W, H), 'over');
  assert.equal(hitTest(items, { x: 110, y: 160 }, W, H), 'under');
  assert.equal(hitTest(items, { x: 5, y: 5 }, W, H), null);
  // A thin bar turned 90° covers a vertical strip instead of a horizontal one.
  const bar = [rect('bar', { x: 0.25, y: 0.45, w: 0.5, h: 0.1, rot: 90 })];
  assert.equal(hitTest(bar, { x: 200, y: 200 }, W, H), 'bar');
  assert.equal(hitTest(bar, { x: 120, y: 300 }, W, H), null);
  const ink = [{ id: 'ink', type: 'ink', width: 0.01, points: [[0, 0], [1, 1]] }];
  assert.equal(hitTest(ink, { x: 200, y: 300 }, W, H), 'ink');
  assert.equal(hitTest(ink, { x: 300, y: 100 }, W, H), null, 'inside the bounds but far from the stroke');
});

test('handles sit on the corners and above the top edge, and follow rotation', () => {
  const box = { x: 100, y: 100, w: 200, h: 100, rot: 0 };
  const pts = handlePoints(box);
  assert.deepEqual(pts.nw, { x: 100, y: 100 });
  assert.deepEqual(pts.se, { x: 300, y: 200 });
  assert.ok(pts.rot.y < 100);
  assert.equal(handleAt(box, { x: 299, y: 201 }, 10), 'se');
  assert.equal(handleAt(box, { x: 200, y: 150 }, 10), null);
  const turned = handlePoints({ ...box, rot: 180 });
  close(turned.nw.x, 300, 'nw x after 180°');
  close(turned.nw.y, 200, 'nw y after 180°');
});

test('moveBy shifts a box or every ink point, in panel units', () => {
  assert.deepEqual(moveBy(rect('a'), 0.1, -0.05), { x: 0.35, y: 0.2 });
  const p = moveBy({ type: 'ink', points: [[0.1, 0.1], [0.2, 0.3]] }, 0.1, 0.1);
  assert.deepEqual(p.points.map((q) => q.map((v) => Math.round(v * 1e6) / 1e6)), [[0.2, 0.2], [0.3, 0.4]]);
});

test('resizeBox keeps the opposite corner still, unrotated and rotated, and never goes below MIN_PX', () => {
  const box = { x: 100, y: 100, w: 200, h: 100, rot: 0 };
  assert.deepEqual(resizeBox(box, 'se', { x: 350, y: 250 }), { x: 100, y: 100, w: 250, h: 150, rot: 0 });
  assert.deepEqual(resizeBox(box, 'nw', { x: 50, y: 80 }), { x: 50, y: 80, w: 250, h: 120, rot: 0 });
  const tiny = resizeBox(box, 'se', { x: 0, y: 0 });
  assert.equal(tiny.w, MIN_PX);
  assert.equal(tiny.h, MIN_PX);
  // Rotated 90°: the box's se corner is drawn at bottom-left; dragging it keeps the nw corner (drawn top-right) still.
  const r = { x: 100, y: 100, w: 200, h: 100, rot: 90 };
  const before = handlePoints(r).nw;
  const out = resizeBox(r, 'se', { x: handlePoints(r).se.x - 20, y: handlePoints(r).se.y + 30 });
  const after = handlePoints(out).nw;
  close(after.x, before.x, 'nw x stays');
  close(after.y, before.y, 'nw y stays');
  close(out.w, 230, 'width grows along the turned axis');
  close(out.h, 120, 'height grows along the turned axis');
});

test('rotateTo points the top of the box at the pointer, snapping to 15° steps on request', () => {
  const box = { x: 100, y: 100, w: 200, h: 100, rot: 0 };
  close(rotateTo(box, { x: 200, y: 0 }), 0, 'straight up');
  close(rotateTo(box, { x: 400, y: 150 }), 90, 'to the right');
  close(rotateTo(box, { x: 0, y: 150 }), 270, 'to the left');
  close(rotateTo(box, { x: 400, y: 140 }, true), 90, 'snapped');
});

test('boxPatch writes a box back as x/y/w/h/rot, and scales ink points from their old bounds', () => {
  assert.deepEqual(boxPatch(rect('a'), { x: 0.1, y: 0.2, w: 0.3, h: 0.4, rot: 10 }), { x: 0.1, y: 0.2, w: 0.3, h: 0.4, rot: 10 });
  const ink = { type: 'ink', points: [[0, 0], [0.2, 0.2]] };
  const p = boxPatch(ink, { x: 0.5, y: 0.5, w: 0.4, h: 0.4, rot: 0 });
  assert.deepEqual(p.points, [[0.5, 0.5], [0.9, 0.9]]);
  assert.equal('x' in p, false, 'ink keeps no box');
  // Values stay in the validator's -1..2 range.
  const far = boxPatch(rect('a'), { x: -5, y: 3, w: 9, h: 0.1, rot: 0 });
  assert.deepEqual([far.x, far.y, far.w], [-1, 2, 2]);
});
