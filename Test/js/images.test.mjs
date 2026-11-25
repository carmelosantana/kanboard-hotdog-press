// The editor's image loader: which assets it fetches, with browser globals stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImages } from '../../Assets/js/app/images.js';

const config = { routes: { image: '/z/1/image/{file_id}' } };

/** Runs fn with fetch, createImageBitmap and Image stubbed; returns the URLs fetched. */
async function fetched(fn) {
  const urls = [];
  const saved = { fetch: globalThis.fetch, createImageBitmap: globalThis.createImageBitmap, Image: globalThis.Image };
  globalThis.fetch = async (url) => { urls.push(url); return { ok: true, blob: async () => ({}) }; };
  globalThis.createImageBitmap = async () => ({ bitmap: true });
  globalThis.Image = class { decode() { urls.push(this.src); return Promise.resolve(); } };
  try {
    await fn();
  } finally {
    Object.assign(globalThis, saved);
  }
  return urls;
}

const page = (items) => ({ id: 'p', layout: 'freeform', bg: 'paper', items });
const item = (id, asset) => ({ id, type: 'image', asset, x: 0, y: 0, w: 1, h: 1, by: 'hand' });

test('an asset whose file_id is not a positive integer is never fetched', async () => {
  const bad = ['0?x=1&controller=WebNotificationController&action=redirect', 0, -1, 1.5, '7', true];
  const assets = Object.fromEntries(bad.map((v, i) => [`b${i}`, { kind: 'image', file_id: v }]));
  const doc = { assets, pages: [page(bad.map((_, i) => item(`i${i}`, `b${i}`)))] };
  const urls = await fetched(() => createImages(config, () => {}).settled(doc));
  assert.deepEqual(urls, []);
});
