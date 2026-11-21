// The minimal PDF writer and the print sheet: structure checked by a small in-test reader, geometry by the page spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildPdf, exportPdf, sheetPage, guideLines, PT_PER_MM, GUIDE_STYLES, CHECK_MM } from '../../Assets/js/core/pdf.js';
import { panelRect, guides } from '../../Assets/js/core/impose.js';
import { paperSize } from '../../Assets/js/core/paper.js';
import { readPdf } from './helpers/pdf-reader.mjs';

const JPEG = new Uint8Array(readFileSync(new URL('../fixtures/pdf/two-tone.jpg', import.meta.url)));
const close = (a, b, msg, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} !== ${b}`);

// ---------------------------------------------------------------- buildPdf

const image = (over = {}) => ({ jpeg: JPEG, px_w: 16, px_h: 16, x_pt: 10, y_pt: 20, w_pt: 100, h_pt: 50, ...over });

test('buildPdf writes a PDF 1.4 whose xref offsets all point at their objects', () => {
  const pdf = readPdf(buildPdf({ pages: [{ w_pt: 200, h_pt: 100, images: [image()], lines: [], rects: [] }] }));
  assert.equal(pdf.pages.length, 1);
  assert.equal(pdf.pages[0].w, 200);
  assert.equal(pdf.pages[0].h, 100);
  assert.ok(pdf.text.split('\n', 2)[1].startsWith('%') && /[\x80-\xff]{4}/.test(pdf.text.split('\n', 2)[1]),
    'binary comment line after the header');
});

test('buildPdf embeds each JPEG verbatim as a DCTDecode image XObject with the caller\'s pixel size', () => {
  const pdf = readPdf(buildPdf({ pages: [{ w_pt: 200, h_pt: 100, images: [image({ px_w: 1200, px_h: 900 })] }] }));
  assert.equal(pdf.images.length, 1);
  const [img] = pdf.images;
  assert.match(img.dict, /\/Type \/XObject/);
  assert.match(img.dict, /\/Width 1200\b/);
  assert.match(img.dict, /\/Height 900\b/);
  assert.match(img.dict, /\/ColorSpace \/DeviceRGB/);
  assert.match(img.dict, /\/BitsPerComponent 8/);
  assert.match(img.dict, /\/Filter \/DCTDecode/);
  assert.deepEqual([...img.stream], [...JPEG]);
  assert.doesNotMatch(pdf.text, /FlateDecode|\/Font/);
});

test('buildPdf places an image with cm and turns it 180 degrees about its centre when asked', () => {
  const pdf = readPdf(buildPdf({
    pages: [{ w_pt: 400, h_pt: 300, images: [image(), image({ x_pt: 30, y_pt: 40, w_pt: 60, h_pt: 80, rotate: 180 })] }],
  }));
  const [upright, turned] = pdf.pages[0].placements;
  assert.deepEqual(upright.cms, [[100, 0, 0, 50, 10, 20]]);
  // -p + 2c with c = (30 + 60/2, 40 + 80/2) = (60, 80), then the unit square scaled onto the box.
  assert.deepEqual(turned.cms, [[-1, 0, 0, -1, 120, 160], [60, 0, 0, 80, 30, 40]]);
  assert.notEqual(upright.name, turned.name);
  assert.deepEqual(Object.keys(pdf.pages[0].xobjects).sort(), [upright.name, turned.name].sort());
});

test('buildPdf strokes lines with width, gray level and an optional dash', () => {
  const pdf = readPdf(buildPdf({
    pages: [{
      w_pt: 100, h_pt: 100,
      lines: [
        { x1: 0, y1: 50, x2: 100, y2: 50, width_pt: 0.5, gray: 0.75, dash: [3, 2] },
        { x1: 1.25, y1: 0, x2: 1.25, y2: 100, width_pt: 1, gray: 0 },
      ],
    }],
  }));
  const c = pdf.pages[0].content;
  assert.match(c, /q\n0\.5 w\n0\.75 G\n\[3 2\] 0 d\n0 50 m\n100 50 l\nS\nQ/);
  assert.match(c, /q\n1 w\n0 G\n\[\] 0 d\n1\.25 0 m\n1\.25 100 l\nS\nQ/);
});

test('buildPdf draws rects filled or stroked', () => {
  const c = readPdf(buildPdf({
    pages: [{
      w_pt: 100, h_pt: 100,
      rects: [
        { x: 1, y: 2, w: 3, h: 4, fill: true, gray: 0 },
        { x: 5, y: 6, w: 7, h: 8, width_pt: 0.25, gray: 0.5, dash: [1, 1] },
      ],
    }],
  })).pages[0].content;
  assert.match(c, /q\n0 g\n1 2 3 4 re\nf\nQ/);
  assert.match(c, /q\n0\.25 w\n0\.5 G\n\[1 1\] 0 d\n5 6 7 8 re\nS\nQ/);
});

test('buildPdf writes numbers without exponents or negative zero', () => {
  const c = readPdf(buildPdf({
    pages: [{ w_pt: 100, h_pt: 100, lines: [{ x1: 1e-9, y1: -0, x2: 1 / 3, y2: 99.99999, width_pt: 0.1, gray: 0 }] }],
  })).pages[0].content;
  assert.match(c, /\n0 0 m\n0\.3333 100 l\n/);
});

test('buildPdf writes several pages, each with its own size and images', () => {
  const pdf = readPdf(buildPdf({
    pages: [
      { w_pt: 300, h_pt: 400, images: [image()] },
      { w_pt: 500, h_pt: 200, images: [image(), image()] },
    ],
  }));
  assert.deepEqual(pdf.pages.map((p) => [p.w, p.h]), [[300, 400], [500, 200]]);
  assert.deepEqual(pdf.pages.map((p) => p.placements.length), [1, 2]);
  assert.equal(Object.keys(pdf.pages[1].xobjects).length, 2);
  assert.equal(pdf.images.length, 3);
});

test('buildPdf rejects bad input', () => {
  const page = { w_pt: 100, h_pt: 100 };
  assert.throws(() => buildPdf({ pages: [] }), /at least one page/);
  assert.throws(() => buildPdf({}), /at least one page/);
  assert.throws(() => buildPdf({ pages: [{ w_pt: 0, h_pt: 100 }] }), /page size/);
  assert.throws(() => buildPdf({ pages: [{ ...page, images: [image({ jpeg: [1, 2] })] }] }), /Uint8Array/);
  assert.throws(() => buildPdf({ pages: [{ ...page, images: [image({ px_w: 0 })] }] }), /px_w/);
  assert.throws(() => buildPdf({ pages: [{ ...page, images: [image({ px_h: 2.5 })] }] }), /px_h/);
  assert.throws(() => buildPdf({ pages: [{ ...page, images: [image({ rotate: 90 })] }] }), /rotate/);
  assert.throws(() => buildPdf({ pages: [{ ...page, lines: [{ x1: NaN, y1: 0, x2: 1, y2: 1 }] }] }), /finite/);
});

// ---------------------------------------------------------------- the print sheet

const dog = (paper = 'letter', margin_mm = 6) => ({ paper, margin_mm });
const panels = () => Array.from({ length: 8 }, () => ({ jpeg: JPEG, px_w: 16, px_h: 16 }));

/** Sheet mm (origin top-left) to PDF points (origin bottom-left), as the module should do it. */
const pt = (H, x, y) => [x * PT_PER_MM, (H - y) * PT_PER_MM];

test('PT_PER_MM is 72/25.4', () => {
  assert.equal(PT_PER_MM, 72 / 25.4);
});

test('exportPdf is one landscape page at the paper size with 8 image XObjects', () => {
  for (const paper of ['letter', 'a4']) {
    const { w_mm, h_mm } = paperSize(paper);
    const pdf = readPdf(exportPdf(dog(paper), panels(), { guides: true }));
    assert.equal(pdf.pages.length, 1);
    close(pdf.pages[0].w, w_mm * PT_PER_MM, `${paper} width`);
    close(pdf.pages[0].h, h_mm * PT_PER_MM, `${paper} height`);
    assert.equal(pdf.images.length, 8);
    assert.equal(pdf.pages[0].placements.length, 8);
  }
});

test('exportPdf turns pages 2-5 (the top row) with a = -1 and d = -1 and places every panel on its quarter', () => {
  const H = paperSize('letter').h_mm;
  const pdf = readPdf(exportPdf(dog(), panels(), {}));
  pdf.pages[0].placements.forEach(({ cms }, i) => {
    const page = i + 1;
    const r = panelRect('letter', page);
    const [x, yTop] = pt(H, r.x, r.y + r.h);
    const place = cms.at(-1);
    close(place[0], r.w * PT_PER_MM, `page ${page} width`);
    close(place[3], r.h * PT_PER_MM, `page ${page} height`);
    close(place[4], x, `page ${page} x`);
    close(place[5], yTop, `page ${page} y`);
    if (page >= 2 && page <= 5) {
      assert.equal(cms.length, 2, `page ${page} has a turn`);
      assert.equal(cms[0][0], -1, `page ${page} a`);
      assert.equal(cms[0][3], -1, `page ${page} d`);
    } else {
      assert.equal(cms.length, 1, `page ${page} is upright`);
      assert.ok(place[0] > 0 && place[3] > 0, `page ${page} a, d > 0`);
    }
  });
});

test('exportPdf takes the panels in page order 1..8 and passes the caller\'s pixel size', () => {
  const ps = panels().map((p, i) => ({ ...p, px_w: 100 + i, px_h: 200 + i }));
  const page = sheetPage(dog(), ps, {});
  page.images.forEach((img, i) => {
    assert.equal(img.px_w, 100 + i);
    assert.equal(img.px_h, 200 + i);
    assert.equal(img.rotate, i >= 1 && i <= 4 ? 180 : 0);
  });
});

test('exportPdf needs exactly 8 panels', () => {
  assert.throws(() => exportPdf(dog(), panels().slice(0, 7), {}), /8 panels/);
  assert.throws(() => exportPdf(dog(), null, {}), /8 panels/);
});

const linesWith = (page, style) => page.lines.filter((l) => l.gray === style.gray && l.width_pt === style.width_pt
  && JSON.stringify(l.dash ?? []) === JSON.stringify(style.dash ?? []));

test('fold and cut guides have distinct styles: folds light gray dashed, the cut darker dash-dot', () => {
  const { fold, cut } = GUIDE_STYLES;
  assert.ok(fold.gray > cut.gray, 'the cut is darker');
  assert.equal(fold.dash.length, 2, 'folds are dashed');
  assert.equal(cut.dash.length, 4, 'the cut is dash-dot');
});

test('guides draw the cut and the folds where impose puts them, the centre fold stopping at the cut', () => {
  for (const paper of ['letter', 'a4']) {
    const { h_mm: H } = paperSize(paper);
    const g = guides(paper);
    const page = sheetPage(dog(paper), panels(), { guides: true });
    const seg = ([x1, y1, x2, y2]) => [...pt(H, x1, y1), ...pt(H, x2, y2)];
    const asArr = (l) => [l.x1, l.y1, l.x2, l.y2];
    const cuts = linesWith(page, GUIDE_STYLES.cut).map(asArr);
    assert.equal(cuts.length, 1);
    seg(g.cut).forEach((v, i) => close(cuts[0][i], v, `${paper} cut ${i}`));
    const folds = linesWith(page, GUIDE_STYLES.fold).map(asArr);
    const [, ...verticals] = g.folds;
    const [cx1, cy, cx2] = g.cut;
    const expected = [[0, cy, cx1, cy], [cx2, cy, g.folds[0][2], cy], ...verticals].map(seg);
    assert.equal(folds.length, expected.length);
    expected.forEach((e, k) => e.forEach((v, i) => close(folds[k][i], v, `${paper} fold ${k}.${i}`)));
  }
});

test('guides off is a clean sheet: no cut, fold, tick or check-square lines, only the panels', () => {
  const page = sheetPage(dog(), panels(), { guides: false });
  assert.equal(linesWith(page, GUIDE_STYLES.cut).length, 0);
  assert.equal(linesWith(page, GUIDE_STYLES.fold).length, 0);
  assert.equal(linesWith(page, GUIDE_STYLES.tick).length, 0);
  assert.equal(linesWith(page, GUIDE_STYLES.check).length, 0);
  assert.equal(page.lines.length, 0);
  assert.equal(page.images.length, 8);
});

test('guideLines is the sheet\'s guide layer on its own, for the on-screen sheet preview', () => {
  for (const d of [dog(), { paper: 'a4', margin_mm: 9 }]) {
    assert.deepEqual(guideLines(d), sheetPage(d, panels()).lines);
  }
});

test('guides take the look\'s guide level: as styled on light papers, mirrored (1 - gray) on night', () => {
  const base = guideLines(dog());
  assert.deepEqual(guideLines({ ...dog(), look: 'kraft' }), base);
  assert.deepEqual(guideLines({ ...dog(), look: 'copy-shop' }), base);
  const night = guideLines({ ...dog(), look: 'night' });
  assert.equal(night.length, base.length);
  night.forEach((l, i) => {
    assert.equal(l.gray, 1 - base[i].gray, `line ${i}`);
    assert.deepEqual({ ...l, gray: 0 }, { ...base[i], gray: 0 }, `line ${i} otherwise unchanged`);
  });
  assert.equal(night.at(-1).gray, 1, 'the check square is white on night');
  assert.deepEqual(sheetPage({ ...dog(), look: 'night' }, panels()).lines, night, 'the print sheet uses them');
});

test('guides default to on', () => {
  assert.equal(linesWith(sheetPage(dog(), panels()), GUIDE_STYLES.cut).length, 1);
  assert.equal(linesWith(sheetPage(dog(), panels(), {}), GUIDE_STYLES.cut).length, 1);
});

test('the check square is 10 x 10 mm in the sheet\'s bottom-left corner, inset by the margin, clear of the cut', () => {
  assert.equal(CHECK_MM, 10);
  for (const [paper, margin] of [['letter', 6], ['a4', 0], ['a4', 10]]) {
    const { h_mm: H } = paperSize(paper);
    const sq = linesWith(sheetPage(dog(paper, margin), panels(), {}), GUIDE_STYLES.check);
    assert.equal(sq.length, 4);
    const xs = sq.flatMap((l) => [l.x1, l.x2]);
    const ys = sq.flatMap((l) => [l.y1, l.y2]);
    const [x0, y0] = pt(H, margin, H - margin);
    close(Math.min(...xs), x0, `${paper}/${margin} left`);
    close(Math.min(...ys), y0, `${paper}/${margin} bottom`);
    close(Math.max(...xs) - Math.min(...xs), 10 * PT_PER_MM, `${paper}/${margin} width`);
    close(Math.max(...ys) - Math.min(...ys), 10 * PT_PER_MM, `${paper}/${margin} height`);
    // Closed outline: every corner is shared by two sides.
    const corners = sq.flatMap((l) => [`${l.x1.toFixed(3)},${l.y1.toFixed(3)}`, `${l.x2.toFixed(3)},${l.y2.toFixed(3)}`]);
    const counts = Object.values(corners.reduce((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}));
    assert.deepEqual(counts, [2, 2, 2, 2], `${paper}/${margin} closed square`);
    // The cut runs at y = H/2 from W/4: the square stays left of it and below it.
    const [cutX, cutY] = pt(H, guides(paper).cut[0], guides(paper).cut[1]);
    assert.ok(Math.max(...xs) < cutX && Math.max(...ys) < cutY, `${paper}/${margin} clear of the cut`);
  }
});

test('the margin is clamped like everywhere else', () => {
  const { h_mm: H } = paperSize('letter');
  const sq = linesWith(sheetPage(dog('letter', 99), panels(), {}), GUIDE_STYLES.check);
  close(Math.min(...sq.flatMap((l) => [l.x1, l.x2])), 10 * PT_PER_MM, 'left at 10 mm');
  close(Math.min(...sq.flatMap((l) => [l.y1, l.y2])), pt(H, 0, H - 10)[1], 'bottom at 10 mm');
});

test('page N gets N tick marks inside its panel, at the reading bottom-right of its safe area', () => {
  for (const paper of ['letter', 'a4']) {
    const { h_mm: H } = paperSize(paper);
    const ticks = linesWith(sheetPage(dog(paper), panels(), { guides: true }), GUIDE_STYLES.tick);
    assert.equal(ticks.length, 36, '1 + 2 + … + 8');
    for (let page = 1; page <= 8; page++) {
      const r = panelRect(paper, page);
      const [left, bottom] = pt(H, r.x, r.y + r.h);
      const [right, top] = pt(H, r.x + r.w, r.y);
      const inside = ticks.filter((l) => [l.x1, l.x2].every((x) => x > left && x < right)
        && [l.y1, l.y2].every((y) => y > bottom && y < top));
      assert.equal(inside.length, page, `${paper} page ${page}`);
      // Reading bottom is the sheet edge: the bottom sheet edge for the bottom row, the top for the turned top row.
      const edge = r.rotate === 180 ? top : bottom;
      const nearest = Math.min(...inside.flatMap((l) => [Math.abs(l.y1 - edge), Math.abs(l.y2 - edge)]));
      close(nearest, 6 * PT_PER_MM, `${paper} page ${page} sits on the margin line`);
    }
  }
});

test('a real JPEG sheet renders with pdftoppm: upright bottom row, turned top row', (t) => {
  let has = true;
  try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); } catch { has = false; }
  if (!has) { t.skip('pdftoppm not installed'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'hdp-pdf-'));
  try {
    const file = join(dir, 'sheet.pdf');
    writeFileSync(file, exportPdf(dog('letter'), panels(), { guides: true }));
    // 10 dpi keeps it tiny: 110 x 85 px. Plain PPM is easy to parse.
    execFileSync('pdftoppm', ['-r', '10', '-singlefile', file, join(dir, 'out')]);
    const ppm = readFileSync(join(dir, 'out.ppm'));
    const [, w, h] = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.toString('latin1', 0, 32)).map(Number);
    const headerLen = ppm.toString('latin1', 0, 32).match(/^P6\s+\d+\s+\d+\s+255\s/)[0].length;
    const px = (fx, fy) => {
      const i = headerLen + 3 * (Math.floor(fy * h) * w + Math.floor(fx * w));
      return [ppm[i], ppm[i + 1], ppm[i + 2]];
    };
    const red = ([r, , b]) => r > 150 && b < 100;
    const blue = ([r, , b]) => b > 150 && r < 100;
    // The JPEG is red over blue. Bottom row (upright): red in the panel's upper part, blue in its lower part.
    for (const col of [0, 1, 2, 3]) {
      const fx = (col + 0.5) / 4;
      assert.ok(red(px(fx, 0.6)), `bottom row col ${col} upper is red: ${px(fx, 0.6)}`);
      assert.ok(blue(px(fx, 0.9)), `bottom row col ${col} lower is blue: ${px(fx, 0.9)}`);
      // Top row (turned 180): blue above, red below.
      assert.ok(blue(px(fx, 0.1)), `top row col ${col} upper is blue: ${px(fx, 0.1)}`);
      assert.ok(red(px(fx, 0.4)), `top row col ${col} lower is red: ${px(fx, 0.4)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
