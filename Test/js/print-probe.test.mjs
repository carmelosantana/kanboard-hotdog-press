// The print probe: a guide-only sheet with line-weight, text-size and photocopier ladders in every panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sheetPage, PT_PER_MM } from '../../Assets/js/core/pdf.js';
import { panelRect, safeArea } from '../../Assets/js/core/impose.js';
import { paperSize, DEFAULT_MARGIN_MM } from '../../Assets/js/core/paper.js';
import { readPdf } from './helpers/pdf-reader.mjs';
import {
  probePage, writeProbes, LINE_WEIGHTS_MM, BLOCK_SIZES_PT, CAP_HEIGHT_EM, HATCH_MM, GRAY_PATCH,
} from '../tools/print-probe.mjs';

const SCRIPT = fileURLToPath(new URL('../tools/print-probe.mjs', import.meta.url));
const close = (a, b, msg, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} !== ${b}`);
const PAPERS = ['letter', 'a4'];

/** Sheet mm box of a PDF-space rect or line. */
function sheetBox(H, { x1, y1, x2, y2, x, y, w, h }) {
  const xs = x1 === undefined ? [x, x + w] : [x1, x2];
  const ys = y1 === undefined ? [y, y + h] : [y1, y2];
  return {
    left: Math.min(...xs) / PT_PER_MM, right: Math.max(...xs) / PT_PER_MM,
    top: H - Math.max(...ys) / PT_PER_MM, bottom: H - Math.min(...ys) / PT_PER_MM,
  };
}

/** The page's safe area in sheet mm (turned top-row pages map their reading box back onto the sheet). */
function safeSheetBox(paper, page) {
  const r = panelRect(paper, page);
  const sa = safeArea(paper, DEFAULT_MARGIN_MM, page);
  const [l, t, rr, b] = [sa.x * r.w, sa.y * r.h, (sa.x + sa.w) * r.w, (sa.y + sa.h) * r.h];
  return r.rotate === 180
    ? { left: r.x + r.w - rr, right: r.x + r.w - l, top: r.y + r.h - b, bottom: r.y + r.h - t }
    : { left: r.x + l, right: r.x + rr, top: r.y + t, bottom: r.y + b };
}

const inPage = (H, paper, page) => (mark) => {
  const b = sheetBox(H, mark);
  const p = panelRect(paper, page);
  return b.left >= p.x && b.right <= p.x + p.w && b.top >= p.y && b.bottom <= p.y + p.h;
};

/** Reading-orientation x of a mark's left edge inside its page (mm). */
function readingX(H, paper, page, mark) {
  const b = sheetBox(H, mark);
  const r = panelRect(paper, page);
  return r.rotate === 180 ? r.x + r.w - b.right : b.left - r.x;
}

test('the ladders hold the agreed values', () => {
  assert.deepEqual(LINE_WEIGHTS_MM, [0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1.0]);
  assert.deepEqual(BLOCK_SIZES_PT, [5, 6, 7, 8, 9, 10, 12, 14]);
  assert.equal(HATCH_MM, 0.25);
  assert.equal(GRAY_PATCH, 0.5);
});

/** The real print sheet's page with guides on, for comparing the probe's guide lines against. */
const realSheet = (paper) => sheetPage({ paper, margin_mm: DEFAULT_MARGIN_MM },
  Array.from({ length: 8 }, () => ({ jpeg: new Uint8Array(), px_w: 1, px_h: 1 })), { guides: true });

test('the probe reuses the real sheet guides and check square, with no images', () => {
  for (const paper of PAPERS) {
    const sheet = realSheet(paper);
    const page = probePage(paper);
    assert.equal(page.w_pt, sheet.w_pt);
    assert.equal(page.h_pt, sheet.h_pt);
    assert.equal(page.images.length, 0);
    assert.deepEqual(page.lines.slice(0, sheet.lines.length), sheet.lines, `${paper} guides first, unchanged`);
  }
});

test('every page carries the ladders in reading order, inside its safe area', () => {
  for (const paper of PAPERS) {
    const H = paperSize(paper).h_mm;
    const page = probePage(paper);
    // Probe marks only: the guides (ticks, check square, folds) come first and are checked above.
    const lines = page.lines.slice(realSheet(paper).lines.length);
    for (let n = 1; n <= 8; n++) {
      const own = inPage(H, paper, n);
      const sa = safeSheetBox(paper, n);
      const weights = lines.filter((l) => own(l) && LINE_WEIGHTS_MM.some((w) => Math.abs(l.width_pt - w * PT_PER_MM) < 1e-9)
        && Math.abs(l.x1 - l.x2) < 1e-9);
      assert.equal(weights.length, LINE_WEIGHTS_MM.length, `${paper} page ${n} line ladder`);
      const byX = [...weights].sort((a, b) => readingX(H, paper, n, a) - readingX(H, paper, n, b));
      byX.forEach((l, i) => close(l.width_pt, LINE_WEIGHTS_MM[i] * PT_PER_MM, `${paper} page ${n} weight ${i}`));

      const blocks = page.rects.filter((r) => own(r) && r.fill && r.gray === 0);
      assert.equal(blocks.length, BLOCK_SIZES_PT.length, `${paper} page ${n} block ladder`);
      const blocksByX = [...blocks].sort((a, b) => readingX(H, paper, n, a) - readingX(H, paper, n, b));
      blocksByX.forEach((r, i) => close(r.h, BLOCK_SIZES_PT[i] * CAP_HEIGHT_EM, `${paper} page ${n} block ${i}`));
      // Blocks sit on one baseline in reading orientation, so the sizes compare at a glance.
      const baselines = blocks.map((r) => { const b = sheetBox(H, r); return panelRect(paper, n).rotate ? b.top : b.bottom; });
      baselines.forEach((v) => close(v, baselines[0], `${paper} page ${n} baseline`));

      const patches = page.rects.filter((r) => own(r) && r.fill && r.gray === GRAY_PATCH);
      assert.equal(patches.length, 1, `${paper} page ${n} gray patch`);
      const hatch = lines.filter((l) => own(l) && Math.abs(l.width_pt - HATCH_MM * PT_PER_MM) < 1e-9);
      assert.ok(hatch.length >= 20, `${paper} page ${n} hatch`);
      const xs = hatch.map((l) => readingX(H, paper, n, l)).sort((a, b) => a - b);
      xs.slice(1).forEach((x, i) => close(x - xs[i], 2 * HATCH_MM, `${paper} page ${n} hatch pitch`));
      assert.ok(readingX(H, paper, n, patches[0]) < xs[0], `${paper} page ${n} patch left of hatch`);

      // Sections run top to bottom in reading orientation: lines, then blocks, then the patches.
      const readingTop = (m) => { const b = sheetBox(H, m); const r = panelRect(paper, n); return r.rotate ? r.y + r.h - b.bottom : b.top - r.y; };
      const lastLine = Math.max(...weights.map((l) => readingTop(l) + Math.abs(l.y1 - l.y2) / PT_PER_MM));
      assert.ok(lastLine < Math.min(...blocks.map(readingTop)), `${paper} page ${n} lines above blocks`);
      assert.ok(Math.max(...blocks.map((r) => readingTop(r) + r.h / PT_PER_MM)) < readingTop(patches[0]),
        `${paper} page ${n} blocks above patches`);

      for (const m of [...weights, ...blocks, ...patches, ...hatch]) {
        const b = sheetBox(H, m);
        const eps = 1e-6;
        assert.ok(b.left >= sa.left - eps && b.right <= sa.right + eps && b.top >= sa.top - eps
          && b.bottom <= sa.bottom + eps, `${paper} page ${n} mark inside the safe area`);
      }
    }
  }
});

test('the script writes both PDFs into the given folder, and they read back as one guide-only page', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'hdp-probe-'));
  try {
    execFileSync(process.execPath, [SCRIPT, dir]);
    for (const paper of PAPERS) {
      const file = join(dir, `print-probe-${paper}.pdf`);
      assert.ok(existsSync(file), file);
      const pdf = readPdf(new Uint8Array(readFileSync(file)));
      const { w_mm, h_mm } = paperSize(paper);
      assert.equal(pdf.pages.length, 1);
      close(pdf.pages[0].w, w_mm * PT_PER_MM, `${paper} width`);
      close(pdf.pages[0].h, h_mm * PT_PER_MM, `${paper} height`);
      assert.equal(pdf.images.length, 0);
      assert.doesNotMatch(pdf.text, /\/Font|\/XObject/);
      assert.match(pdf.pages[0].content, / re\nf\n/, 'filled blocks');
    }
    let has = true;
    try { execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' }); } catch { has = false; }
    if (!has) { t.diagnostic('pdfinfo not installed'); return; }
    for (const paper of PAPERS) {
      const info = execFileSync('pdfinfo', [join(dir, `print-probe-${paper}.pdf`)], { encoding: 'utf8' });
      assert.match(info, /Pages:\s+1\n/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeProbes returns the two paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdp-probe-'));
  try {
    assert.deepEqual(writeProbes(dir), PAPERS.map((p) => join(dir, `print-probe-${p}.pdf`)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
