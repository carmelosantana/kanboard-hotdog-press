// The print probe: the real sheet's guides and check square, plus in every panel a line-weight ladder, a ladder of
// solid blocks at text cap heights, a 50% gray patch and a fine hatch. Print, photocopy, read the smallest mark that
// survives (see Test/tools/README.md). Usage: node Test/tools/print-probe.mjs [out-dir]  (default: a new temp dir)
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPdf, guideLines, PT_PER_MM } from '../../Assets/js/core/pdf.js';
import { panelRect, readingToSheet, safeArea } from '../../Assets/js/core/impose.js';
import { DEFAULT_MARGIN_MM, paperSize } from '../../Assets/js/core/paper.js';

/** Stroke widths in mm, left to right. */
export const LINE_WEIGHTS_MM = [0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1.0];
/** Font sizes in pt whose cap height each block matches, left to right. */
export const BLOCK_SIZES_PT = [5, 6, 7, 8, 9, 10, 12, 14];
/** Cap height as a fraction of the font size (typical for sans and serif faces). */
export const CAP_HEIGHT_EM = 0.7;
/** Hatch line width and gap, mm. */
export const HATCH_MM = 0.25;
/** Gray level of the flat patch (0 black .. 1 white). */
export const GRAY_PATCH = 0.5;

const PAPERS = ['letter', 'a4'];

// Layout in reading-orientation mm from the safe area's top-left corner.
const PITCH = 7;
const LINE_X = 2;
const LINE_LEN = 15;
const BLOCK_W = 4;
const BASELINE = 22;
const PATCH = { y: 28, h: 10, w: 20 };
const HATCH_X = 28;
const HATCH_COUNT = 40;

/**
 * The probe sheet as one buildPdf page at `paper`, default margin.
 * @param {import('../../Assets/js/core/paper.js').PaperId} paper
 */
export function probePage(paper) {
  // The real sheet's guide layer, so the probe's guides come from the same code path as the print export.
  const H = paperSize(paper).h_mm;
  const lines = guideLines({ paper, margin_mm: DEFAULT_MARGIN_MM });
  const rects = [];

  for (let n = 1; n <= 8; n++) {
    const r = panelRect(paper, n);
    const sa = safeArea(paper, DEFAULT_MARGIN_MM, n);
    const [ox, oy] = [sa.x * r.w, sa.y * r.h];
    /** Reading mm (from the safe-area corner) to PDF points. */
    const at = (lx, ly) => {
      const [sx, sy] = readingToSheet(paper, n, ox + lx, oy + ly);
      return [sx * PT_PER_MM, (H - sy) * PT_PER_MM];
    };
    const line = (x1, y1, x2, y2, width_mm) => {
      const [a, b] = at(x1, y1);
      const [c, d] = at(x2, y2);
      return { x1: a, y1: b, x2: c, y2: d, width_pt: width_mm * PT_PER_MM, gray: 0 };
    };
    const rect = (x, y, w, h, gray) => {
      const [a, b] = at(x, y);
      const [c, d] = at(x + w, y + h);
      return { x: Math.min(a, c), y: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b), fill: true, gray };
    };

    LINE_WEIGHTS_MM.forEach((w, i) => lines.push(line(LINE_X + i * PITCH, 0, LINE_X + i * PITCH, LINE_LEN, w)));
    BLOCK_SIZES_PT.forEach((size, i) => {
      const cap = (size * CAP_HEIGHT_EM) / PT_PER_MM;
      rects.push(rect(i * PITCH, BASELINE - cap, BLOCK_W, cap, 0));
    });
    rects.push(rect(0, PATCH.y, PATCH.w, PATCH.h, GRAY_PATCH));
    for (let k = 0; k < HATCH_COUNT; k++) {
      const x = HATCH_X + k * 2 * HATCH_MM + HATCH_MM / 2;
      lines.push(line(x, PATCH.y, x, PATCH.y + PATCH.h, HATCH_MM));
    }
  }
  const { w_mm, h_mm } = paperSize(paper);
  return { w_pt: w_mm * PT_PER_MM, h_pt: h_mm * PT_PER_MM, images: [], lines, rects };
}

/**
 * Write print-probe-letter.pdf and print-probe-a4.pdf into `dir`.
 * @param {string} dir
 * @returns {string[]} the two paths
 */
export function writeProbes(dir) {
  mkdirSync(dir, { recursive: true });
  return PAPERS.map((paper) => {
    const file = join(dir, `print-probe-${paper}.pdf`);
    writeFileSync(file, buildPdf({ pages: [probePage(paper)] }));
    return file;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'hdp-print-probe-'));
  for (const file of writeProbes(dir)) console.log(file);
}
