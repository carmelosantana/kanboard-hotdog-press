// Social frames: preset sizes, the fitted page rect, the frame plan, drawing a frame, and the LinkedIn PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SOCIAL_PRESETS, SOCIAL_PADDING, slug, frameRect, socialPlan, renderFrame, linkedInPdf,
} from '../../Assets/js/core/social.js';
import { panelSize, paperSize } from '../../Assets/js/core/paper.js';
import { panelRect } from '../../Assets/js/core/impose.js';
import { colorOf, grayHex } from '../../Assets/js/core/looks.js';
import { PT_PER_MM } from '../../Assets/js/core/pdf.js';
import { newDog } from '../../Assets/js/core/dog.js';
import { readPdf } from './helpers/pdf-reader.mjs';
import { fakeContext, callsOf, setsOf } from './helpers/fake-ctx.mjs';

const JPEG = new Uint8Array(readFileSync(new URL('../fixtures/pdf/two-tone.jpg', import.meta.url)));
const close = (a, b, msg, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} !== ${b}`);
const aspectOf = ({ w, h }) => w / h;

test('SOCIAL_PRESETS holds exactly the sizes in the global constraints', () => {
  const sizes = Object.fromEntries(Object.entries(SOCIAL_PRESETS).map(([id, p]) => [id, [p.w, p.h]]));
  assert.deepEqual(sizes, {
    'carousel-3x4': [1080, 1440],
    'carousel-4x5': [1080, 1350],
    cover: [1080, 1440],
    pin: [1000, 1500],
    story: [1080, 1920],
    sheet: [2160, 1528],
  });
  assert.ok(Object.isFrozen(SOCIAL_PRESETS));
});

test('slug is lowercase ASCII with hyphens, at most 40 characters, falling back to zine', () => {
  assert.equal(slug('Hot Dog Press #1: Relish!'), 'hot-dog-press-1-relish');
  assert.equal(slug('  Crème Brûlée — Zine  '), 'creme-brulee-zine');
  assert.equal(slug('🌭🌭'), 'zine');
  assert.equal(slug(''), 'zine');
  assert.equal(slug(undefined), 'zine');
  const long = slug('a'.repeat(30) + ' ' + 'b'.repeat(30));
  assert.ok(long.length <= 40, long);
  assert.equal(long, `${'a'.repeat(30)}-${'b'.repeat(9)}`);
  assert.equal(slug(`${'a'.repeat(39)} b`), 'a'.repeat(39), 'no trailing hyphen after the cut');
});

/** Check a rect fits the frame with at least the even padding, centred, at the aspect, in whole pixels. */
function assertFitted(rect, frame, aspect) {
  const pad = Math.round(SOCIAL_PADDING * Math.min(frame.w, frame.h));
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(rect[k]), `${k} is an integer`);
  const [left, top] = [rect.x, rect.y];
  const [right, bottom] = [frame.w - rect.x - rect.w, frame.h - rect.y - rect.h];
  for (const side of [left, top, right, bottom]) assert.ok(side >= pad, `padding ${side} >= ${pad}`);
  assert.ok(Math.abs(left - right) <= 1 && Math.abs(top - bottom) <= 1, 'centred');
  assert.ok(Math.min(left, top) === pad, 'touches the padding on the limiting axis');
  assert.ok(Math.abs(rect.w / rect.h - aspect) < 2 / Math.min(rect.w, rect.h), `aspect ${rect.w / rect.h} ~ ${aspect}`);
}

test('frameRect fits a page in the frame with even padding, centred, in integer pixels', () => {
  for (const paper of ['letter', 'a4']) {
    const aspect = aspectOf(panelSize(paper));
    for (const id of Object.keys(SOCIAL_PRESETS)) {
      assertFitted(frameRect(id, aspect), SOCIAL_PRESETS[id], aspect);
    }
  }
  // Letter on the 3:4 carousel, worked by hand: pad 65, height-limited 1310, width round(1310 * 69.85/107.95).
  assert.deepEqual(frameRect('carousel-3x4', 69.85 / 107.95), { x: 116, y: 65, w: 848, h: 1310 });
  // A wide content box is width-limited.
  assert.deepEqual(frameRect('carousel-3x4', 2), { x: 65, y: 483, w: 950, h: 475 });
});

test('frameRect rejects unknown presets and bad aspects', () => {
  assert.throws(() => frameRect('tiktok', 1), /Unknown social preset/);
  assert.throws(() => frameRect('cover', 0), /aspect/);
  assert.throws(() => frameRect('cover', Number.NaN), /aspect/);
});

test('socialPlan: a carousel is pages 1..8 in order, named hotdog-<slug>-<preset>-01..08.png', () => {
  const dog = newDog({ title: 'Mustard Monthly', paper: 'letter' });
  for (const preset of ['carousel-3x4', 'carousel-4x5']) {
    const frames = socialPlan(dog, preset);
    assert.equal(frames.length, 8);
    const rect = frameRect(preset, aspectOf(panelSize('letter')));
    frames.forEach((f, i) => {
      assert.equal(f.name, `hotdog-mustard-monthly-${preset}-0${i + 1}.png`);
      assert.deepEqual(f.source, { kind: 'page', index: i });
      assert.equal(f.w, SOCIAL_PRESETS[preset].w);
      assert.equal(f.h, SOCIAL_PRESETS[preset].h);
      assert.deepEqual(f.rect, rect);
      assert.equal(f.background, colorOf('kraft', 'paper'));
    });
  }
});

test('socialPlan: cover, pin and story are page 1; sheet is the whole sheet at the paper aspect', () => {
  const dog = newDog({ title: 'Relish', paper: 'a4' });
  dog.look = 'night';
  for (const preset of ['cover', 'pin', 'story']) {
    const [f, ...rest] = socialPlan(dog, preset);
    assert.equal(rest.length, 0);
    assert.equal(f.name, `hotdog-relish-${preset}.png`);
    assert.deepEqual(f.source, { kind: 'page', index: 0 });
    assert.deepEqual([f.w, f.h], [SOCIAL_PRESETS[preset].w, SOCIAL_PRESETS[preset].h]);
    assert.deepEqual(f.rect, frameRect(preset, aspectOf(panelSize('a4'))));
    assert.equal(f.background, colorOf('night', 'paper'));
  }
  const [sheet, ...more] = socialPlan(dog, 'sheet');
  assert.equal(more.length, 0);
  assert.equal(sheet.name, 'hotdog-relish-sheet.png');
  assert.deepEqual(sheet.source, { kind: 'sheet' });
  const { w_mm, h_mm } = paperSize('a4');
  assert.deepEqual(sheet.rect, frameRect('sheet', w_mm / h_mm));
});

test('socialPlan rejects an unknown preset', () => {
  assert.throws(() => socialPlan(newDog(), 'reel'), /Unknown social preset/);
});

test('renderFrame fills the frame with the background, then draws the page into its rect', () => {
  const dog = newDog({ paper: 'letter' });
  const frame = socialPlan(dog, 'carousel-3x4')[2];
  const ctx = fakeContext();
  renderFrame(ctx, dog, frame, {});
  assert.equal(setsOf(ctx, 'fillStyle')[0], frame.background);
  assert.deepEqual(callsOf(ctx, 'fillRect')[0], [0, 0, frame.w, frame.h], 'background first, whole frame');
  assert.deepEqual(callsOf(ctx, 'translate')[0], [frame.rect.x, frame.rect.y]);
  // renderPage clips to its own px box: the frame's rect size.
  assert.deepEqual(callsOf(ctx, 'rect')[0], [0, 0, frame.rect.w, frame.rect.h]);
  assert.equal(callsOf(ctx, 'save').length, callsOf(ctx, 'restore').length, 'balanced save/restore');
});

test('renderFrame in black and white paints the background gray too', () => {
  const dog = newDog();
  const frame = socialPlan(dog, 'cover')[0];
  const ctx = fakeContext();
  renderFrame(ctx, dog, frame, { bw: true });
  assert.equal(setsOf(ctx, 'fillStyle')[0], grayHex(frame.background));
});

test('renderFrame draws the sheet scaled to the rect width', () => {
  const dog = newDog({ paper: 'letter' });
  const frame = socialPlan(dog, 'sheet')[0];
  const ctx = fakeContext();
  renderFrame(ctx, dog, frame, {});
  const k = frame.rect.w / paperSize('letter').w_mm;
  const page1 = panelRect(paperSize('letter'), 1);
  const translates = callsOf(ctx, 'translate');
  assert.deepEqual(translates[0], [frame.rect.x, frame.rect.y]);
  close(translates[1][0], page1.x * k, 'page 1 x at the frame scale');
  close(translates[1][1], page1.y * k, 'page 1 y at the frame scale');
  assert.ok(callsOf(ctx, 'stroke').length > 0, 'sheet guides drawn');
});

test('linkedInPdf: 8 upright pages at the panel size in points, one JPEG filling each, in reading order', () => {
  const dog = newDog({ paper: 'letter' });
  const panels = Array.from({ length: 8 }, (_, i) => ({ jpeg: JPEG, px_w: 100 + i, px_h: 160 }));
  const pdf = readPdf(linkedInPdf(dog, panels));
  const { w, h } = panelSize('letter');
  assert.equal(pdf.pages.length, 8);
  pdf.pages.forEach((page, i) => {
    close(page.w, w * PT_PER_MM, 'page width');
    close(page.h, h * PT_PER_MM, 'page height');
    assert.equal(page.placements.length, 1, 'one image');
    const [{ name, cms }] = page.placements;
    assert.equal(cms.length, 1, 'no 180° turn');
    const [a, b, c, d, e, f] = cms[0];
    close(a, page.w, 'fills width');
    close(d, page.h, 'fills height');
    assert.deepEqual([b, c, e, f], [0, 0, 0, 0]);
    assert.match(page.xobjects[name].dict, new RegExp(`/Width ${100 + i} `), `page ${i + 1} holds panel ${i + 1}`);
  });
});

test('linkedInPdf needs exactly 8 panels', () => {
  assert.throws(() => linkedInPdf(newDog(), []), /8 panels/);
});
