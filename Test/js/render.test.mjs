// The renderer: a Dog page or the whole sheet drawn onto a recording fake 2D context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, TOKENS, renderPage, renderSheet, layoutText, colorOf } from '../../Assets/js/core/render.js';
import { luminance } from '../../Assets/js/core/filters.js';
import { guideLines, GUIDE_STYLES, PT_PER_MM } from '../../Assets/js/core/pdf.js';
import { panelRect } from '../../Assets/js/core/impose.js';
import { paperSize } from '../../Assets/js/core/paper.js';
import { newDog } from '../../Assets/js/core/dog.js';
import { LINE_HEIGHT } from '../../Assets/js/core/layouts.js';
import { FONT_METRICS } from '../../Assets/js/core/textfit.js';
import { fakeContext, callsOf, setsOf, drawable, FAKE_EM } from './helpers/fake-ctx.mjs';

const BRAND = {
  mustard: '#E8B517', ketchup: '#C8322B', kraft: '#D9C4A0', copy: '#FAF7F0', toner: '#1B1A17', relish: '#4E7D32',
};
const PX_W = 400;
const PX_H = 600;
const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} !== ${b}`);

/** A Dog whose first page holds `items`; look and assets as given. */
function dogWith(items, { look = 'kraft', bg = 'paper', assets = {} } = {}) {
  const dog = newDog({ paper: 'letter' });
  dog.look = look;
  dog.assets = assets;
  dog.pages[0].bg = bg;
  dog.pages[0].items = items;
  return dog;
}

function render(items, opts = {}, renderOpts = {}) {
  const ctx = fakeContext();
  renderPage(ctx, dogWith(items, opts), 0, { px_w: PX_W, px_h: PX_H, ...renderOpts });
  return ctx;
}

const text = (over = {}) => ({
  id: 't1', type: 'text', by: 'hand', x: 0.1, y: 0.1, w: 0.5, h: 0.5,
  font: 'body', size: 0.05, align: 'left', color: 'toner', runs: [{ text: 'Hi' }], ...over,
});
const imageItem = (over = {}) => ({
  id: 'i1', type: 'image', by: 'hand', asset: 'a1', x: 0, y: 0, w: 0.5, h: 0.5, fit: 'cover', focus: [0.5, 0.5], ...over,
});
const asset = { a1: { kind: 'image', file_id: 1, w: 100, h: 100 } };

/** The single drawImage call, as {src, sx, sy, sw, sh, dx, dy, dw, dh}. */
function theDraw(ctx) {
  const draws = callsOf(ctx, 'drawImage');
  assert.equal(draws.length, 1, 'one drawImage');
  const [src, sx, sy, sw, sh, dx, dy, dw, dh] = draws[0];
  return { src, sx, sy, sw, sh, dx, dy, dw, dh };
}

// ---------------------------------------------------------------- looks and colours

test('LOOKS has kraft, copy-shop and night, each with every colour token and the three font roles', () => {
  for (const name of ['kraft', 'copy-shop', 'night']) {
    const look = LOOKS[name];
    assert.ok(look, name);
    for (const token of TOKENS) assert.match(look.colors[token], /^#[0-9A-F]{6}$/, `${name} ${token}`);
    for (const role of ['display', 'body', 'mono']) assert.equal(typeof look.fonts[role], 'string', `${name} ${role}`);
    assert.ok(TOKENS.includes(look.text), `${name} text token`);
  }
  assert.deepEqual([...TOKENS].sort(), ['copy', 'ketchup', 'kraft', 'mustard', 'paper', 'relish', 'toner']);
});

test('the looks use the brand colours: kraft paper, copy-shop copy paper, night toner with light ink', () => {
  assert.equal(LOOKS.kraft.colors.paper, BRAND.kraft);
  assert.equal(LOOKS['copy-shop'].colors.paper, BRAND.copy);
  assert.equal(LOOKS.night.colors.paper, BRAND.toner);
  assert.equal(LOOKS.night.colors.toner, BRAND.copy, 'toner is the look\'s ink, light on night');
  for (const name of ['kraft', 'copy-shop', 'night']) {
    for (const token of ['mustard', 'ketchup', 'relish']) assert.equal(LOOKS[name].colors[token], BRAND[token]);
  }
  assert.match(LOOKS.kraft.fonts.display, /^"Anton"/);
  assert.match(LOOKS.kraft.fonts.mono, /^"Courier Prime"/);
  assert.match(LOOKS.kraft.fonts.body, /^"Atkinson Hyperlegible"/);
});

test('colorOf resolves a token by look, falls back to the look\'s text colour, and maps to gray in bw', () => {
  assert.equal(colorOf('kraft', 'ketchup'), BRAND.ketchup);
  assert.equal(colorOf('kraft', 'nope'), BRAND.toner);
  assert.equal(colorOf('night', undefined), BRAND.copy);
  assert.equal(colorOf('no-such-look', 'paper'), BRAND.kraft, 'unknown look is kraft');
  const g = luminance(0xC8, 0x32, 0x2B).toString(16).padStart(2, '0').toUpperCase();
  assert.equal(colorOf('kraft', 'ketchup', true), `#${g}${g}${g}`);
});

// ---------------------------------------------------------------- the page

test('renderPage clips to the page and fills the background with the look\'s paper first', () => {
  const ctx = render([]);
  assert.deepEqual(callsOf(ctx, 'rect')[0], [0, 0, PX_W, PX_H]);
  assert.equal(callsOf(ctx, 'clip').length, 1);
  assert.deepEqual(setsOf(ctx, 'fillStyle'), [BRAND.kraft]);
  assert.deepEqual(callsOf(ctx, 'fillRect'), [[0, 0, PX_W, PX_H]]);
  assert.equal(callsOf(ctx, 'save').length, callsOf(ctx, 'restore').length, 'balanced save/restore');
});

test('the background follows the look and the page bg token', () => {
  assert.deepEqual(setsOf(render([], { look: 'night' }), 'fillStyle'), [BRAND.toner]);
  assert.deepEqual(setsOf(render([], { look: 'copy-shop' }), 'fillStyle'), [BRAND.copy]);
  assert.deepEqual(setsOf(render([], { bg: 'mustard' }), 'fillStyle'), [BRAND.mustard]);
  assert.deepEqual(setsOf(render([], { bg: 'bogus' }), 'fillStyle'), [BRAND.kraft], 'unknown bg is the paper');
});

test('renderPage refuses a page index outside the Dog', () => {
  for (const i of [-1, 8, 1.5]) {
    assert.throws(() => renderPage(fakeContext(), newDog(), i, { px_w: 10, px_h: 10 }), RangeError, String(i));
  }
});

test('items draw in array order', () => {
  const ctx = render([
    { id: 's1', type: 'shape', by: 'hand', shape: 'rect', x: 0, y: 0, w: 1, h: 1, fill: 'mustard' },
    text({ color: 'ketchup', runs: [{ text: 'top' }] }),
  ]);
  const order = ctx.calls.filter((c) => c[0] === 'fill' || c[0] === 'fillText').map((c) => c[0]);
  assert.deepEqual(order, ['fill', 'fillText']);
  assert.deepEqual(setsOf(ctx, 'fillStyle'), [BRAND.kraft, BRAND.mustard, BRAND.ketchup]);
});

// ---------------------------------------------------------------- text

test('text sets the font from its role and size in panel-height units, alphabetic baseline, colour token', () => {
  const ctx = render([text({ font: 'display', size: 0.05 })]);
  assert.deepEqual(setsOf(ctx, 'font'), [`30px ${LOOKS.kraft.fonts.display}`]);
  assert.deepEqual(setsOf(ctx, 'textBaseline'), ['alphabetic']);
  const [[t, x, y]] = callsOf(ctx, 'fillText');
  assert.deepEqual([t, x], ['Hi', 40]);
  close(y, 60 + FONT_METRICS.display.ascent * 30, 'first baseline one accent ascent below the box top');
  assert.equal(setsOf(ctx, 'fillStyle').at(-1), BRAND.toner);
});

test('an unknown font role uses the body face', () => {
  assert.deepEqual(setsOf(render([text({ font: 'anton' })]), 'font'), [`30px ${LOOKS.kraft.fonts.body}`]);
});

test('text is clipped to its box', () => {
  const ctx = render([text()]);
  assert.deepEqual(callsOf(ctx, 'rect')[1], [40, 60, 200, 300]);
  assert.equal(callsOf(ctx, 'clip').length, 2);
});

test('layoutText wraps greedily by words at the box width (measured), breaking at newlines', () => {
  // 30px font, 15px per character in the fake; box 200px wide holds 13 characters.
  const item = text({ runs: [{ text: 'one two three four ' }, { text: 'five\nsix' }] });
  const out = layoutText(fakeContext(), item, PX_W, PX_H);
  assert.deepEqual(out.lines, ['one two three', 'four five', 'six']);
  assert.equal(out.size_px, 30);
  close(out.line_px, 30 * LINE_HEIGHT, 'line height');
  assert.equal(out.visible, 3);
  assert.equal(out.overflow, false);
});

test('layoutText breaks a word longer than the box into pieces', () => {
  const out = layoutText(fakeContext(), text({ runs: [{ text: 'abcdefghijklmnopqrstuvwxyz ok' }] }), PX_W, PX_H);
  assert.deepEqual(out.lines, ['abcdefghijklm', 'nopqrstuvwxyz', 'ok']);
});

test('layoutText counts only lines that fit the box height and flags overflow', () => {
  // Box 300px high, 30px body font, 36px lines: the first line needs (ascent + descent) × 30 ≈ 32.4px, so 8 fit
  // (32.4 + 7 × 36 = 284.4).
  const words = Array.from({ length: 12 }, (_, i) => `w${String(i).padStart(10, '0')}`).join(' ');
  const out = layoutText(fakeContext(), text({ runs: [{ text: words }] }), PX_W, PX_H);
  assert.equal(out.lines.length, 12);
  assert.equal(out.visible, 8);
  assert.equal(out.overflow, true);
  const ctx = render([text({ runs: [{ text: words }] })]);
  assert.equal(callsOf(ctx, 'fillText').length, 8, 'lines beyond the box are not drawn');
});

test('text aligns left, center and right within its box', () => {
  for (const [align, x] of [['left', 40], ['center', 140], ['right', 240], ['bogus', 40]]) {
    const ctx = render([text({ align })]);
    assert.deepEqual(setsOf(ctx, 'textAlign'), [align === 'bogus' ? 'left' : align]);
    assert.equal(callsOf(ctx, 'fillText')[0][1], x, align);
  }
});

test('lines stack at the line height', () => {
  const ctx = render([text({ runs: [{ text: 'a\nb\nc' }] })]);
  const ys = callsOf(ctx, 'fillText').map((c) => c[2]);
  ys.forEach((y, i) => close(y, 60 + FONT_METRICS.body.ascent * 30 + i * 30 * LINE_HEIGHT, `line ${i}`));
});

test('every drawn line, accents and descenders included, sits inside its box in each font', () => {
  // Alphabetic baselines: the first one sits the font's accent ascent below the box top (Á, ¿ and Ñ need it),
  // and no drawn line's descent passes the box bottom.
  const words = 'ÁÉÍ ¿Qué? Ñu gjpq '.repeat(8);
  for (const font of ['display', 'body', 'mono']) {
    const item = text({ font, runs: [{ text: words }] });
    const ctx = render([item]);
    assert.deepEqual(setsOf(ctx, 'textBaseline'), ['alphabetic'], font);
    const { ascent, descent } = FONT_METRICS[font];
    const size = item.size * PX_H;
    const top = item.y * PX_H;
    const bottom = top + item.h * PX_H;
    const ys = callsOf(ctx, 'fillText').map((c) => c[2]);
    assert.ok(ys.length > 1, `${font}: several lines`);
    close(ys[0] - ascent * size, top, `${font}: the tallest glyph touches the box top`);
    for (const y of ys) assert.ok(y + descent * size <= bottom + 1e-9, `${font}: line at ${y} inside the box`);
    ys.forEach((y, i) => close(y, ys[0] + i * size * LINE_HEIGHT, `${font} line ${i}`));
  }
});

test('a box shorter than one line still draws its first line, clipped to the box, and reports overflow', () => {
  const item = text({ font: 'display', h: 0.05, runs: [{ text: 'Hola\nmundo' }] }); // 30px box, Anton line ≈ 46px
  const out = layoutText(fakeContext(), item, PX_W, PX_H);
  assert.equal(out.visible, 0, 'no line fits whole');
  assert.equal(out.overflow, true);
  const ctx = render([item]);
  assert.deepEqual(callsOf(ctx, 'fillText').map((c) => c[0]), ['Hola'], 'the first line is drawn');
  assert.deepEqual(callsOf(ctx, 'rect').at(-1), [40, 60, 200, 30], 'clipped to the box');
});

test('text tolerates missing runs', () => {
  const ctx = render([text({ runs: undefined })]);
  assert.equal(callsOf(ctx, 'fillText').length, 0);
});

// ---------------------------------------------------------------- images and stickers

test('a cover image fills its box, centred on the focus, clipped to the box', () => {
  // Box 200 x 300 px; a 100 x 100 image scales by 3 to 300 x 300 and overflows sideways.
  const img = drawable(100, 100);
  const ctx = render([imageItem()], { assets: asset }, { images: { a1: img } });
  const d = theDraw(ctx);
  assert.equal(d.src, img);
  assert.deepEqual([d.sx, d.sy, d.sw, d.sh], [0, 0, 100, 100]);
  assert.deepEqual([d.dx, d.dy, d.dw, d.dh], [-50, 0, 300, 300]);
  assert.deepEqual(callsOf(ctx, 'rect')[1], [0, 0, 200, 300]);
});

test('the cover focus moves the image towards its point but never uncovers the box', () => {
  const img = drawable(100, 100);
  const at = (focus) => theDraw(render([imageItem({ focus })], { assets: asset }, { images: { a1: img } })).dx;
  assert.equal(at([0.4, 0.5]), -20, 'focus point lands on the box centre when it can');
  assert.equal(at([0, 0.5]), 0, 'left edge stays covered');
  assert.equal(at([1, 0.5]), -100, 'right edge stays covered');
});

test('a contain image fits whole inside its box, centred', () => {
  const ctx = render([imageItem({ fit: 'contain' })], { assets: asset }, { images: { a1: drawable(100, 100) } });
  const d = theDraw(ctx);
  assert.deepEqual([d.dx, d.dy, d.dw, d.dh], [0, 50, 200, 200]);
});

test('a crop [x, y, w, h] in fractions picks the source rectangle', () => {
  const ctx = render([imageItem({ crop: [0.5, 0, 0.5, 0.5], fit: 'contain' })], { assets: asset },
    { images: { a1: drawable(100, 80) } });
  const d = theDraw(ctx);
  assert.deepEqual([d.sx, d.sy, d.sw, d.sh], [50, 0, 50, 40]);
  assert.deepEqual([d.dx, d.dy, d.dw, d.dh], [0, 70, 200, 160]);
});

test('a missing, placeholder or undecoded asset draws a light box with a cross instead, never throwing', () => {
  const cases = [
    { assets: {}, images: {} },
    { assets: asset, images: {} },
    { assets: { a1: { kind: 'placeholder', name: 'x.jpg' } }, images: { a1: drawable(100, 100) } },
    { assets: asset, images: { a1: drawable(0, 0) } },
    { assets: asset, images: undefined },
  ];
  for (const { assets, images } of cases) {
    const ctx = render([imageItem()], { assets }, { images });
    assert.equal(callsOf(ctx, 'drawImage').length, 0);
    assert.deepEqual(callsOf(ctx, 'fillRect')[1], [0, 0, 200, 300], 'box filled');
    assert.deepEqual(callsOf(ctx, 'moveTo'), [[0, 0], [200, 0]], 'two diagonals');
    assert.deepEqual(callsOf(ctx, 'lineTo'), [[200, 300], [0, 300]]);
    assert.deepEqual(callsOf(ctx, 'strokeRect'), [[0, 0, 200, 300]]);
  }
});

test('a sticker draws its image contained in its box', () => {
  const img = drawable(50, 100);
  const sticker = { id: 'k1', type: 'sticker', by: 'hand', asset: 'a1', x: 0, y: 0, w: 0.5, h: 0.5 };
  const d = theDraw(render([sticker], { assets: asset }, { images: { a1: img } }));
  assert.equal(d.src, img);
  assert.deepEqual([d.dx, d.dy, d.dw, d.dh], [25, 0, 150, 300]);
});

// ---------------------------------------------------------------- shapes and ink

test('a rect shape fills and strokes with its tokens; stroke width in panel-width units', () => {
  const shape = { id: 's1', type: 'shape', by: 'hand', shape: 'rect', x: 0.1, y: 0.1, w: 0.5, h: 0.5,
    fill: 'mustard', stroke: 'ketchup', stroke_width: 0.01 };
  const ctx = render([shape]);
  assert.deepEqual(callsOf(ctx, 'rect')[1], [40, 60, 200, 300]);
  assert.equal(setsOf(ctx, 'fillStyle').at(-1), BRAND.mustard);
  assert.deepEqual(setsOf(ctx, 'strokeStyle'), [BRAND.ketchup]);
  assert.deepEqual(setsOf(ctx, 'lineWidth'), [4]);
  assert.equal(callsOf(ctx, 'fill').length, 1);
  assert.equal(callsOf(ctx, 'stroke').length, 1);
});

test('an ellipse shape inscribes its box; no fill or stroke token means none drawn', () => {
  const shape = { id: 's1', type: 'shape', by: 'hand', shape: 'ellipse', x: 0.1, y: 0.1, w: 0.5, h: 0.5,
    stroke: 'toner' };
  const ctx = render([shape]);
  assert.deepEqual(callsOf(ctx, 'ellipse'), [[140, 210, 100, 150, 0, 0, 2 * Math.PI]]);
  assert.equal(callsOf(ctx, 'fill').length, 0);
  assert.equal(callsOf(ctx, 'stroke').length, 1);
});

test('ink strokes its points in panel units with round caps and joins, width in panel-width units', () => {
  const ink = { id: 'k1', type: 'ink', by: 'hand', points: [[0.1, 0.9], [0.5, 0.5], [0.25, 0.25]], width: 0.01,
    color: 'ketchup' };
  const ctx = render([ink]);
  assert.deepEqual(setsOf(ctx, 'lineCap'), ['round']);
  assert.deepEqual(setsOf(ctx, 'lineJoin'), ['round']);
  assert.deepEqual(setsOf(ctx, 'lineWidth'), [4]);
  assert.deepEqual(setsOf(ctx, 'strokeStyle'), [BRAND.ketchup]);
  assert.deepEqual(callsOf(ctx, 'moveTo'), [[40, 540]]);
  assert.deepEqual(callsOf(ctx, 'lineTo'), [[200, 300], [100, 150]]);
  assert.equal(callsOf(ctx, 'stroke').length, 1);
});

test('a one-point ink stroke is a dot; an empty one draws nothing', () => {
  const dot = render([{ id: 'k1', type: 'ink', by: 'hand', points: [[0.5, 0.5]], width: 0.01, color: 'toner' }]);
  assert.deepEqual(callsOf(dot, 'moveTo'), [[200, 300]]);
  assert.deepEqual(callsOf(dot, 'lineTo'), [[200, 300]]);
  const none = render([{ id: 'k1', type: 'ink', by: 'hand', points: [], color: 'toner' }]);
  assert.equal(callsOf(none, 'stroke').length, 0);
});

test('unknown item types are skipped', () => {
  const ctx = render([{ id: 'x', type: 'hologram', by: 'hand', x: 0, y: 0, w: 1, h: 1 }]);
  assert.deepEqual(callsOf(ctx, 'fillRect'), [[0, 0, PX_W, PX_H]]);
});

// ---------------------------------------------------------------- rotation and bw

test('rot (degrees, clockwise) turns an item about its box centre', () => {
  const ctx = render([text({ rot: 90 })]);
  const centre = [140, 210];
  assert.deepEqual(callsOf(ctx, 'translate'), [centre, centre.map((v) => -v)]);
  assert.deepEqual(callsOf(ctx, 'rotate'), [[Math.PI / 2]]);
  assert.equal(callsOf(render([text({ rot: 0 })]), 'rotate').length, 0);
});

test('a rotated ink stroke turns about the centre of its points\' bounds', () => {
  const ink = { id: 'k1', type: 'ink', by: 'hand', points: [[0, 0], [0.5, 1]], width: 0.01, color: 'toner', rot: 45 };
  const ctx = render([ink]);
  assert.deepEqual(callsOf(ctx, 'translate')[0], [100, 300]);
  close(callsOf(ctx, 'rotate')[0][0], Math.PI / 4, 'angle');
});

test('bw draws every colour as its luminance gray', () => {
  const ctx = render([
    text({ color: 'ketchup' }),
    { id: 'k1', type: 'ink', by: 'hand', points: [[0, 0], [1, 1]], width: 0.01, color: 'relish' },
  ], { bg: 'mustard' }, { bw: true });
  const styles = [...setsOf(ctx, 'fillStyle'), ...setsOf(ctx, 'strokeStyle')];
  assert.equal(styles.length, 3);
  for (const s of styles) assert.match(s, /^#([0-9A-F]{2})\1\1$/, `${s} is gray`);
  assert.equal(setsOf(ctx, 'fillStyle')[0], colorOf('kraft', 'mustard', true));
});

// ---------------------------------------------------------------- the sheet

test('renderSheet draws the 8 pages into their quarters, the top row turned 180 degrees', () => {
  const dog = newDog({ paper: 'a4' });
  const k = 2;
  const ctx = fakeContext();
  renderSheet(ctx, dog, { px_per_mm: k, guides: false });
  const { w, h } = { w: (297 / 4) * k, h: (210 / 2) * k };
  // Each page's background fill is in its own panel space.
  assert.deepEqual(callsOf(ctx, 'fillRect'), Array.from({ length: 8 }, () => [0, 0, w, h]));
  // Translations come in page order: to the panel corner, plus to the far corner for turned pages.
  const expected = [];
  for (let page = 1; page <= 8; page++) {
    const r = panelRect('a4', page);
    expected.push([r.x * k, r.y * k]);
    if (r.rotate === 180) expected.push([w, h]);
  }
  callsOf(ctx, 'translate').forEach(([x, y], i) => {
    close(x, expected[i][0], `translate ${i} x`);
    close(y, expected[i][1], `translate ${i} y`);
  });
  assert.equal(callsOf(ctx, 'rotate').length, 4, 'pages 2-5');
  for (const [a] of callsOf(ctx, 'rotate')) assert.equal(a, Math.PI);
  assert.equal(callsOf(ctx, 'setLineDash').length, 0, 'guides off');
});

test('renderSheet passes the images and bw through to each page', () => {
  const dog = newDog({ paper: 'letter' });
  dog.assets = asset;
  dog.pages[3].items = [imageItem()];
  const img = drawable(100, 100);
  const ctx = fakeContext();
  renderSheet(ctx, dog, { px_per_mm: 1, images: { a1: img }, guides: false, bw: true });
  assert.equal(theDraw(ctx).src, img);
  assert.equal(setsOf(ctx, 'fillStyle')[0], colorOf('kraft', 'paper', true));
});

test('renderSheet draws the print guide layer on top, in px, with the print styles', () => {
  const dog = newDog({ paper: 'letter' });
  const k = 10; // every print width is over 1 px here, so none is raised to the preview minimum
  const ctx = fakeContext();
  renderSheet(ctx, dog, { px_per_mm: k });
  const lines = guideLines(dog);
  const H = paperSize('letter').h_mm;
  const px = (pt) => (pt / PT_PER_MM) * k;
  const strokes = callsOf(ctx, 'stroke').length;
  assert.equal(strokes, lines.length, 'one stroke per guide line');
  const lastFill = ctx.calls.findLastIndex((c) => c[0] === 'fillRect');
  const firstDash = ctx.calls.findIndex((c) => c[0] === 'setLineDash');
  assert.ok(firstDash > lastFill, 'guides after the pages');
  const moves = callsOf(ctx, 'moveTo');
  const tos = callsOf(ctx, 'lineTo');
  lines.forEach((l, i) => {
    close(moves[i][0], px(l.x1), `line ${i} x1`);
    close(moves[i][1], (H - l.y1 / PT_PER_MM) * k, `line ${i} y1`);
    close(tos[i][0], px(l.x2), `line ${i} x2`);
    close(tos[i][1], (H - l.y2 / PT_PER_MM) * k, `line ${i} y2`);
  });
  const cut = lines.findIndex((l) => l.dash === GUIDE_STYLES.cut.dash);
  close(setsOf(ctx, 'lineWidth')[cut], px(GUIDE_STYLES.cut.width_pt), 'cut width');
  callsOf(ctx, 'setLineDash')[cut][0].forEach((d, i) => close(d, px(GUIDE_STYLES.cut.dash[i]), `cut dash ${i}`));
  const g = Math.round(GUIDE_STYLES.cut.gray * 255).toString(16).padStart(2, '0').toUpperCase();
  assert.equal(setsOf(ctx, 'strokeStyle')[cut], `#${g}${g}${g}`);
  assert.equal(callsOf(ctx, 'save').length, callsOf(ctx, 'restore').length, 'balanced save/restore');
});

test('each look has a guide level: 0 (dark guides) on light papers, 1 (light guides) on night', () => {
  assert.equal(LOOKS.kraft.guide, 0);
  assert.equal(LOOKS['copy-shop'].guide, 0);
  assert.equal(LOOKS.night.guide, 1);
});

test('the sheet preview draws night guides light and kraft guides dark, matching the print', () => {
  const strokes = (look) => {
    const dog = newDog({ paper: 'a4' });
    dog.look = look;
    const ctx = fakeContext();
    renderSheet(ctx, dog, { px_per_mm: 3 });
    return setsOf(ctx, 'strokeStyle');
  };
  assert.equal(strokes('kraft').at(-1), '#000000', 'check square black on kraft');
  assert.equal(strokes('night').at(-1), '#FFFFFF', 'check square white on night');
  const g = Math.round((1 - GUIDE_STYLES.fold.gray) * 255).toString(16).padStart(2, '0').toUpperCase();
  assert.equal(strokes('night')[0], `#${g}${g}${g}`, 'night fold');
});

test('preview guide strokes are at least 1 px wide at small scales; print widths stay physical', () => {
  const ctx = fakeContext();
  renderSheet(ctx, newDog({ paper: 'letter' }), { px_per_mm: 0.5 });
  const widths = setsOf(ctx, 'lineWidth');
  assert.equal(widths.length, guideLines(newDog()).length);
  for (const w of widths) assert.equal(w, 1);
  const big = fakeContext();
  renderSheet(big, newDog({ paper: 'letter' }), { px_per_mm: 20 });
  close(setsOf(big, 'lineWidth')[0], (GUIDE_STYLES.fold.width_pt / PT_PER_MM) * 20, 'fold at 20 px/mm');
});

test('the fake context measures text predictably', () => {
  const ctx = fakeContext();
  ctx.font = '20px x';
  assert.equal(ctx.measureText('abcd').width, 4 * FAKE_EM * 20);
});

test('layoutText terminates on a box too narrow for one character', () => {
  for (const w of [0, -0.1, 0.01]) {
    const out = layoutText(fakeContext(), text({ w, runs: [{ text: 'ab cd' }] }), PX_W, PX_H);
    assert.deepEqual(out.lines, ['a', 'b', 'c', 'd'], `w ${w}`);
  }
});

test('layoutText puts each bullet run of a list on its own line, and keeps "\\n" inside runs as a hard break', async () => {
  const { place } = await import('../../Assets/js/core/layouts.js');
  const [, list] = place('list', { title: { text: 'T' }, list: { items: ['Calendula', 'Lemon balm', 'Chamomile'] } }, 'letter', { page: 6 });
  const ctx = fakeContext();
  const out = layoutText(ctx, list, PX_W, PX_H);
  assert.deepEqual(out.lines, ['• Calendula', '• Lemon balm', '• Chamomile']);
  // Plain runs still join with nothing between them (they are spans of one paragraph).
  assert.deepEqual(layoutText(ctx, text({ runs: [{ text: 'He' }, { text: 'llo' }] }), PX_W, PX_H).lines, ['Hello']);
  assert.deepEqual(layoutText(ctx, text({ runs: [{ text: 'a\nb' }] }), PX_W, PX_H).lines, ['a', 'b']);
  // A styled run that happens to start with the bullet in a non-list item stays on its line.
  assert.deepEqual(layoutText(ctx, text({ runs: [{ text: 'Hi ' }, { text: '• x' }] }), PX_W, PX_H).lines, ['Hi • x']);
});

test('an item whose type names an Object.prototype key is skipped, not called', () => {
  for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.doesNotThrow(() => render([{ ...text(), type }]), type);
  }
});
