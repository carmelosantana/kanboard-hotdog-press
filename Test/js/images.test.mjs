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

test('only assets an item uses are loaded', async () => {
  const doc = {
    assets: {
      used: { kind: 'image', file_id: 5 },
      dead: { kind: 'image', file_id: 6 },
      deadSticker: { kind: 'sticker', data: 'data:image/png;base64,AAAA' },
    },
    pages: [page([item('i1', 'used')])],
  };
  const urls = await fetched(() => createImages(config, () => {}).settled(doc));
  assert.deepEqual(urls, ['/z/1/image/5']);
});

test('an asset whose file_id is not a positive integer is never fetched', async () => {
  const bad = ['0?x=1&controller=WebNotificationController&action=redirect', 0, -1, 1.5, '7', true];
  const assets = Object.fromEntries(bad.map((v, i) => [`b${i}`, { kind: 'image', file_id: v }]));
  const doc = { assets, pages: [page(bad.map((_, i) => item(`i${i}`, `b${i}`)))] };
  const urls = await fetched(() => createImages(config, () => {}).settled(doc));
  assert.deepEqual(urls, []);
});

test('500 asset ids aliasing one file_id fetch it once and all draw it', async () => {
  const ids = Array.from({ length: 500 }, (_, i) => `a${i}`);
  const doc = {
    assets: Object.fromEntries(ids.map((id) => [id, { kind: 'image', file_id: 9 }])),
    pages: [page(ids.map((id, i) => item(`i${i}`, id)))],
  };
  const images = createImages(config, () => {});
  const urls = await fetched(() => images.settled(doc));
  assert.deepEqual(urls, ['/z/1/image/9']);
  for (const id of ids) assert.ok(images.map[id], `${id} has the shared image`);
  assert.equal(images.map.a0, images.map.a499);
});

test('two different file_ids fetch twice', async () => {
  const doc = {
    assets: { a: { kind: 'image', file_id: 1 }, b: { kind: 'image', file_id: 2 }, c: { kind: 'image', file_id: 2 } },
    pages: [page([item('i1', 'a'), item('i2', 'b'), item('i3', 'c')])],
  };
  const urls = await fetched(() => createImages(config, () => {}).settled(doc));
  assert.deepEqual(urls.sort(), ['/z/1/image/1', '/z/1/image/2']);
});

test('identical inline data under many asset ids decodes once', async () => {
  const data = 'data:image/png;base64,AAAA';
  const ids = Array.from({ length: 50 }, (_, i) => `s${i}`);
  const doc = {
    assets: Object.fromEntries(ids.map((id) => [id, { kind: 'sticker', data }])),
    pages: [page(ids.map((id, i) => item(`i${i}`, id)))],
  };
  const urls = await fetched(() => createImages(config, () => {}).settled(doc));
  assert.deepEqual(urls, [data]);
});
