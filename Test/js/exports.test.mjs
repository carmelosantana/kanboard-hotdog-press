// The export builders: 300 dpi panels for the print PDF and the LinkedIn PDF, the social frames and their ZIPs, and
// the black-and-white path, which must run toGray and levels over the rendered pixels before anything is encoded.
// Canvases and encoders are fakes that record what happens, in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRINT_DPI, JPEG_QUALITY, BW_LEVELS, panelPixels, finishBw, rasterPanels, printPdf, linkedInFile, socialFiles,
  printName,
} from '../../Assets/js/app/exports.js';
import { luminance } from '../../Assets/js/core/filters.js';
import { newDog } from '../../Assets/js/core/dog.js';
import { readPdf } from './helpers/pdf-reader.mjs';
import { readZip } from './helpers/zip-reader.mjs';
import { fakeContext, callsOf } from './helpers/fake-ctx.mjs';

/** One colour pixel repeated, as getImageData would hand it back. */
const RGB = [200, 100, 50];

/** Fake canvases: each records its size, its 2D calls and what was put back; `log` is the global order. */
function fakeCanvases() {
  const log = [];
  const made = [];
  const canvas = (w, h) => {
    const ctx = fakeContext();
    const c = { width: w, height: h, ctx, put: null, getContext: () => ctx };
    ctx.getImageData = (x, y, gw, gh) => {
      log.push(['get', c, x, y, gw, gh]);
      const data = new Uint8ClampedArray(gw * gh * 4);
      for (let i = 0; i < data.length; i += 4) data.set([...RGB, 255], i);
      return { width: gw, height: gh, data };
    };
    ctx.putImageData = (img, x, y) => { log.push(['put', c, x, y]); c.put = img; };
    made.push(c);
    return c;
  };
  const encode = async (c, type, quality) => {
    log.push(['encode', c, type, quality]);
    return new TextEncoder().encode(`${type}:${c.width}x${c.height}`);
  };
  return { canvas, encode, log, made };
}

const dog = () => ({ ...newDog({ title: 'Plant Medicine', paper: 'letter' }) });

test('print panels are 300 dpi panels of the paper, JPEG at 0.9', async () => {
  assert.equal(PRINT_DPI, 300);
  assert.equal(JPEG_QUALITY, 0.9);
  // Letter landscape 279.4 x 215.9 mm: a panel is 69.85 x 107.95 mm = 2.75 x 4.25 in.
  assert.deepEqual(panelPixels('letter'), { px_w: 825, px_h: 1275 });
  assert.deepEqual(panelPixels('a4'), { px_w: Math.round((297 / 4 / 25.4) * 300), px_h: Math.round((210 / 2 / 25.4) * 300) });
  const f = fakeCanvases();
  const panels = await rasterPanels(dog(), {}, { canvas: f.canvas, encode: f.encode });
  assert.equal(panels.length, 8);
  for (const p of panels) assert.deepEqual([p.px_w, p.px_h], [825, 1275]);
  assert.deepEqual(f.log.filter((e) => e[0] === 'encode').map((e) => [e[2], e[3]]), Array(8).fill(['image/jpeg', 0.9]));
  assert.equal(f.log.some((e) => e[0] === 'get'), false, 'colour exports never touch the pixels');
});

test('finishBw runs toGray then levels over the whole canvas and puts the pixels back', () => {
  const f = fakeCanvases();
  const c = f.canvas(3, 2);
  finishBw(c.ctx, 3, 2);
  assert.deepEqual(f.log.map((e) => [e[0], e[2], e[3], e[4], e[5]].filter((x) => x !== undefined)), [['get', 0, 0, 3, 2], ['put', 0, 0]]);
  const gray = luminance(...RGB);
  const level = Math.round(((gray - BW_LEVELS.black) * 255) / (BW_LEVELS.white - BW_LEVELS.black));
  for (let i = 0; i < c.put.data.length; i += 4) assert.deepEqual([...c.put.data.subarray(i, i + 4)], [level, level, level, 255]);
});

test('B&W print panels are filtered before they are encoded, and drawn with gray colours', async () => {
  const f = fakeCanvases();
  await rasterPanels(dog(), {}, { bw: true, canvas: f.canvas, encode: f.encode });
  for (const c of f.made) {
    const steps = f.log.filter((e) => e[1] === c).map((e) => e[0]);
    assert.deepEqual(steps, ['get', 'put', 'encode'], 'filter, put back, then encode');
    assert.ok(c.put.data.every((v, i) => i % 4 === 3 || v === c.put.data[i - (i % 4)]), 'r = g = b');
    const fills = callsOf(c.ctx, 'fillRect').length;
    assert.ok(fills > 0, 'the page was drawn');
  }
  const kraft = fakeCanvases();
  await rasterPanels(dog(), {}, { bw: true, canvas: kraft.canvas, encode: kraft.encode });
  const firstFill = kraft.made[0].ctx.calls.find((c) => c[0] === 'set' && c[1] === 'fillStyle')[2];
  assert.match(firstFill, /^#([0-9a-f]{2})\1\1$/i, `a gray paper, not ${firstFill}`);
});

test('printPdf is one sheet page with the guides as asked; the name carries the paper', async () => {
  const f = fakeCanvases();
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = await printPdf(dog(), {}, { guides: false, canvas: f.canvas, encode: async () => jpeg });
  const parsed = readPdf(pdf);
  assert.ok(parsed, 'a PDF');
  const withGuides = await printPdf(dog(), {}, { guides: true, canvas: f.canvas, encode: async () => jpeg });
  assert.ok(withGuides.length > pdf.length, 'guides add strokes');
  assert.equal(printName(dog()), 'hotdog-plant-medicine-letter.pdf');
});

test('the LinkedIn PDF has 8 pages and B&W filters its panels too', async () => {
  const f = fakeCanvases();
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const file = await linkedInFile(dog(), {}, { bw: true, canvas: f.canvas, encode: async (c) => { f.log.push(['encode', c]); return jpeg; } });
  assert.equal(file.name, 'hotdog-plant-medicine-linkedin.pdf');
  assert.equal(file.type, 'application/pdf');
  assert.equal((Buffer.from(file.data).toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 8);
  for (const c of f.made) assert.deepEqual(f.log.filter((e) => e[1] === c).map((e) => e[0]), ['get', 'put', 'encode']);
});

test('the carousel is one ZIP of 8 PNG frames at 1080 x 1440, pages 1..8 in order; 4:5 is 1080 x 1350', async () => {
  const f = fakeCanvases();
  const file = await socialFiles(dog(), 'carousel-3x4', {}, { canvas: f.canvas, encode: f.encode });
  assert.equal(file.name, 'hotdog-plant-medicine-carousel-3x4.zip');
  assert.equal(file.type, 'application/zip');
  const entries = readZip(file.data);
  assert.deepEqual(entries.map((e) => e.name), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `hotdog-plant-medicine-carousel-3x4-0${n}.png`));
  assert.deepEqual(entries.map((e) => new TextDecoder().decode(e.data)), Array(8).fill('image/png:1080x1440'));
  const fiveFour = await socialFiles(dog(), 'carousel-4x5', {}, { canvas: f.canvas, encode: f.encode });
  assert.deepEqual(new Set(readZip(fiveFour.data).map((e) => new TextDecoder().decode(e.data))), new Set(['image/png:1080x1350']));
  const bluesky = await socialFiles(dog(), 'bluesky', {}, { canvas: f.canvas, encode: f.encode });
  assert.equal(readZip(bluesky.data).length, 4);
});

test('one-frame presets are a single PNG; the story carries its caption; B&W filters frames before encoding', async () => {
  const f = fakeCanvases();
  for (const [id, size] of [['cover', '1080x1440'], ['pin', '1000x1500'], ['story', '1080x1920'], ['sheet', '2160x1528']]) {
    const file = await socialFiles(dog(), id, {}, { canvas: f.canvas, encode: f.encode });
    assert.equal(file.name, `hotdog-plant-medicine-${id}.png`);
    assert.equal(file.type, 'image/png');
    assert.equal(new TextDecoder().decode(file.data), `image/png:${size}`);
  }
  const story = fakeCanvases();
  await socialFiles(dog(), 'story', {}, { caption: 'Made to order. Fold your own.', canvas: story.canvas, encode: story.encode });
  assert.ok(callsOf(story.made[0].ctx, 'fillText').some(([t]) => /Fold your own/.test(t)), 'the caption is drawn');

  const bw = fakeCanvases();
  await socialFiles(dog(), 'cover', {}, { bw: true, canvas: bw.canvas, encode: bw.encode });
  assert.deepEqual(bw.log.map((e) => e[0]), ['get', 'put', 'encode']);
});

test('printPdf with inkSaver leaves every page white instead of the look\'s paper', async () => {
  const plain = fakeCanvases();
  await rasterPanels(dog(), {}, { canvas: plain.canvas, encode: plain.encode });
  const firstFill = (c) => c.ctx.calls.find((e) => e[0] === 'set' && e[1] === 'fillStyle')[2];
  assert.equal(firstFill(plain.made[0]), '#D9C4A0', 'kraft paper by default');
  const f = fakeCanvases();
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  await printPdf(dog(), {}, { inkSaver: true, canvas: f.canvas, encode: async (c) => { f.made.includes(c) || f.made.push(c); return jpeg; } });
  assert.equal(f.made.length, 8);
  for (const c of f.made) assert.equal(firstFill(c), '#FFFFFF');
});
