// A minimal PDF 1.4 writer (JPEG images, lines, rects; no fonts, no compression) and the one-sheet print export.
// Pure, no DOM: the browser rasterises the panels to JPEG and hands the bytes in.
import { clampMargin, panelSize, resolvePaper } from './paper.js';
import { panelRect, guides as sheetGuides, safeArea } from './impose.js';

/** 1 mm in PDF points. */
export const PT_PER_MM = 72 / 25.4;
/** Side of the print-check square in mm. */
export const CHECK_MM = 10;

const mm = (v) => v * PT_PER_MM;

/**
 * Line styles of the print aids (widths and dashes in points). Folds are light gray dashes, the cut a darker
 * dash-dot, so the two never read alike; page ticks are mid-gray solid strokes, the check square solid black.
 */
export const GUIDE_STYLES = Object.freeze({
  fold: Object.freeze({ width_pt: mm(0.2), gray: 0.7, dash: Object.freeze([mm(2), mm(1.5)]) }),
  cut: Object.freeze({ width_pt: mm(0.3), gray: 0.3, dash: Object.freeze([mm(4), mm(1), mm(0.6), mm(1)]) }),
  tick: Object.freeze({ width_pt: mm(0.25), gray: 0.45 }),
  check: Object.freeze({ width_pt: mm(0.2), gray: 0 }),
});

/** Page tick marks: length and spacing in mm. */
const TICK_LEN_MM = 2;
const TICK_GAP_MM = 0.8;

// ---------------------------------------------------------------- buildPdf

/**
 * Everything is in PDF space: points, origin at the page's bottom-left corner.
 * @typedef {{jpeg: Uint8Array, px_w: number, px_h: number, x_pt: number, y_pt: number, w_pt: number, h_pt: number,
 *   rotate?: 0|180}} PdfImage  a baseline JPEG (DeviceRGB) scaled onto the box; 180 turns it about the box centre
 * @typedef {{x1: number, y1: number, x2: number, y2: number, width_pt?: number, gray?: number,
 *   dash?: readonly number[]}} PdfLine  stroked; width defaults to 1, gray (0 black..1 white) to 0, no dash
 * @typedef {{x: number, y: number, w: number, h: number, fill?: boolean, width_pt?: number, gray?: number,
 *   dash?: readonly number[]}} PdfRect  filled with `gray` when `fill`, otherwise stroked like a line
 * @typedef {{w_pt: number, h_pt: number, images?: PdfImage[], lines?: PdfLine[], rects?: PdfRect[]}} PdfPage
 *   drawn in this order: images, rects, lines
 */

/**
 * Write a PDF with one or more pages. One API for every caller: a single page is `{pages: [page]}`.
 * @param {{pages: PdfPage[]}} doc
 * @returns {Uint8Array}
 */
export function buildPdf({ pages } = /** @type {any} */ ({})) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('buildPdf needs at least one page');
  pages.forEach(checkPage);

  // Object ids: 1 catalog, 2 page tree, then per page: the page, its content stream, its images.
  let next = 3;
  const plan = pages.map((page) => ({
    page,
    pageId: next++,
    contentId: next++,
    imageIds: (page.images ?? []).map(() => next++),
  }));

  /** @type {Uint8Array[]} index = object id */
  const objects = [];
  objects[1] = ascii('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = ascii(`<< /Type /Pages /Kids [${plan.map((p) => `${p.pageId} 0 R`).join(' ')}] /Count ${plan.length} >>`);
  for (const { page, pageId, contentId, imageIds } of plan) {
    const xobjects = imageIds.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ');
    const resources = xobjects ? `<< /XObject << ${xobjects} >> >>` : '<< >>';
    objects[pageId] = ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.w_pt)} ${num(page.h_pt)}]`
      + ` /Resources ${resources} /Contents ${contentId} 0 R >>`);
    const content = ascii(contentStream(page));
    objects[contentId] = streamObject(`<< /Length ${content.length} >>`, content);
    (page.images ?? []).forEach((img, i) => {
      objects[imageIds[i]] = streamObject(`<< /Type /XObject /Subtype /Image /Width ${img.px_w} /Height ${img.px_h}`
        + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>`, img.jpeg);
    });
  }

  // Header with a binary comment line, so transfer tools treat the file as binary.
  const parts = [ascii('%PDF-1.4\n'), new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  let offset = parts[0].length + parts[1].length;
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = offset;
    for (const part of [ascii(`${id} 0 obj\n`), objects[id], ascii('\nendobj\n')]) {
      parts.push(part);
      offset += part.length;
    }
  }
  // Each xref entry is exactly 20 bytes: 10-digit offset, 5-digit generation, n/f, space, newline.
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(ascii(xref));
  return concat(parts);
}

/** @param {PdfPage} page */
function contentStream(page) {
  let s = '';
  (page.images ?? []).forEach((img, i) => {
    s += 'q\n';
    if (img.rotate === 180) {
      // p' = -p + 2c turns the box half a revolution about its centre c.
      s += `-1 0 0 -1 ${num(2 * img.x_pt + img.w_pt)} ${num(2 * img.y_pt + img.h_pt)} cm\n`;
    }
    s += `${num(img.w_pt)} 0 0 ${num(img.h_pt)} ${num(img.x_pt)} ${num(img.y_pt)} cm\n/Im${i + 1} Do\nQ\n`;
  });
  for (const r of page.rects ?? []) {
    const box = `${num(r.x)} ${num(r.y)} ${num(r.w)} ${num(r.h)} re\n`;
    s += r.fill ? `q\n${num(r.gray ?? 0)} g\n${box}f\nQ\n` : `q\n${strokeStyle(r)}${box}S\nQ\n`;
  }
  for (const l of page.lines ?? []) {
    s += `q\n${strokeStyle(l)}${num(l.x1)} ${num(l.y1)} m\n${num(l.x2)} ${num(l.y2)} l\nS\nQ\n`;
  }
  return s;
}

/** @param {{width_pt?: number, gray?: number, dash?: readonly number[]}} st */
function strokeStyle({ width_pt = 1, gray = 0, dash = [] }) {
  return `${num(width_pt)} w\n${num(gray)} G\n[${dash.map(num).join(' ')}] 0 d\n`;
}

/** @param {PdfPage} page */
function checkPage(page) {
  if (!(page?.w_pt > 0 && page.h_pt > 0 && finite(page.w_pt, page.h_pt))) {
    throw new Error('Each PDF page needs a positive finite page size (w_pt, h_pt)');
  }
  for (const img of page.images ?? []) {
    if (!(img.jpeg instanceof Uint8Array)) throw new Error('Image jpeg must be a Uint8Array');
    for (const key of ['px_w', 'px_h']) {
      if (!Number.isInteger(img[key]) || img[key] < 1) throw new Error(`Image ${key} must be a positive integer`);
    }
    if (![undefined, 0, 180].includes(img.rotate)) throw new Error('Image rotate must be 0 or 180');
    mustBeFinite(img.x_pt, img.y_pt, img.w_pt, img.h_pt);
  }
  for (const r of page.rects ?? []) mustBeFinite(r.x, r.y, r.w, r.h, r.width_pt ?? 1, r.gray ?? 0, ...(r.dash ?? []));
  for (const l of page.lines ?? []) mustBeFinite(l.x1, l.y1, l.x2, l.y2, l.width_pt ?? 1, l.gray ?? 0, ...(l.dash ?? []));
}

const finite = (...vs) => vs.every((v) => typeof v === 'number' && Number.isFinite(v));
function mustBeFinite(...vs) {
  if (!finite(...vs)) throw new Error('PDF coordinates, sizes, widths and dashes must be finite numbers');
}

/** A PDF number: at most 4 decimals, never an exponent or -0. */
function num(v) {
  const r = Math.round(v * 1e4) / 1e4;
  return r === 0 ? '0' : String(r);
}

const encoder = new TextEncoder();
/** @param {string} s ASCII only */
const ascii = (s) => encoder.encode(s);

/** @param {string} dict @param {Uint8Array} data */
const streamObject = (dict, data) => concat([ascii(`${dict}\nstream\n`), data, ascii('\nendstream')]);

/** @param {Uint8Array[]} parts */
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ---------------------------------------------------------------- the print sheet

/** @typedef {{jpeg: Uint8Array, px_w: number, px_h: number}} RasterPanel */

/**
 * The print sheet as one buildPdf page: the 8 panels on their quarters (top row turned 180°), then, with guides on,
 * the folds, the cut, the page ticks and the 10 mm check square. Guides off is a clean sheet: nothing over the artwork.
 *
 * - Page ticks: page N gets N short strokes at the bottom-right corner of its safe area in reading orientation,
 *   i.e. on the margin line along the sheet edge (no fonts needed).
 * - Check square: a closed 10 x 10 mm outline in the sheet's bottom-left corner, its outer sides inset by the margin
 *   (the printer's unprintable border), so it prints in the corner of page 6's safe area, far from the cut.
 * - Where the cut runs, the centre fold is left out, so the cut's dash-dot is not muddied by fold dashes.
 *
 * @param {{paper: import('./paper.js').PaperId, margin_mm?: number}} dog
 * @param {RasterPanel[]} rasterPanels pages 1..8 in order
 * @param {{guides?: boolean}} [opts]
 * @returns {PdfPage}
 */
export function sheetPage(dog, rasterPanels, { guides = true } = {}) {
  if (!Array.isArray(rasterPanels) || rasterPanels.length !== 8) {
    throw new Error('exportPdf needs 8 panels, pages 1..8 in order');
  }
  const paper = resolvePaper(dog.paper);
  const H = paper.h_mm;
  const margin = clampMargin(dog.margin_mm);
  /** Sheet mm (origin top-left, y down) to PDF points (origin bottom-left, y up): the one conversion. */
  const toPt = (x, y) => [mm(x), mm(H - y)];
  const line = (x1, y1, x2, y2, style) => {
    const [a, b] = toPt(x1, y1);
    const [c, d] = toPt(x2, y2);
    return { x1: a, y1: b, x2: c, y2: d, ...style };
  };

  const images = rasterPanels.map(({ jpeg, px_w, px_h }, i) => {
    const r = panelRect(paper, i + 1);
    const [x_pt, y_pt] = toPt(r.x, r.y + r.h);
    return { jpeg, px_w, px_h, x_pt, y_pt, w_pt: mm(r.w), h_pt: mm(r.h), rotate: r.rotate };
  });

  const lines = [];
  if (guides) {
    const { cut, folds: [centre, ...verticals] } = sheetGuides(paper);
    const [cx1, cy, cx2] = cut;
    lines.push(
      line(centre[0], cy, cx1, cy, GUIDE_STYLES.fold),
      line(cx2, cy, centre[2], cy, GUIDE_STYLES.fold),
      ...verticals.map(([x1, y1, x2, y2]) => line(x1, y1, x2, y2, GUIDE_STYLES.fold)),
      line(...cut, GUIDE_STYLES.cut),
    );
    for (let page = 1; page <= 8; page++) lines.push(...pageTicks(paper, margin, page, line));
    const [x0, y0, s] = [margin, H - margin, CHECK_MM];
    lines.push(
      line(x0, y0, x0 + s, y0, GUIDE_STYLES.check),
      line(x0 + s, y0, x0 + s, y0 - s, GUIDE_STYLES.check),
      line(x0 + s, y0 - s, x0, y0 - s, GUIDE_STYLES.check),
      line(x0, y0 - s, x0, y0, GUIDE_STYLES.check),
    );
  }

  return { w_pt: mm(paper.w_mm), h_pt: mm(H), images, lines, rects: [] };
}

/** N strokes for page N, at the reading bottom-right of its safe area, mapped onto the sheet. */
function pageTicks(paper, margin, page, line) {
  const r = panelRect(paper, page);
  const { w, h } = panelSize(paper);
  const sa = safeArea(paper, margin, page);
  const right = (sa.x + sa.w) * w;
  const bottom = (sa.y + sa.h) * h;
  // Reading-orientation panel mm to sheet mm.
  const at = (lx, ly) => (r.rotate === 180 ? [r.x + w - lx, r.y + h - ly] : [r.x + lx, r.y + ly]);
  return Array.from({ length: page }, (_, i) => {
    const lx = right - i * TICK_GAP_MM;
    return line(...at(lx, bottom), ...at(lx, bottom - TICK_LEN_MM), GUIDE_STYLES.tick);
  });
}

/**
 * The print PDF: one landscape page at the paper size.
 * @param {{paper: import('./paper.js').PaperId, margin_mm?: number}} dog
 * @param {RasterPanel[]} rasterPanels pages 1..8 in order, each a 300 dpi JPEG of the panel in reading orientation
 * @param {{guides?: boolean}} [opts] guides default to on
 * @returns {Uint8Array}
 */
export function exportPdf(dog, rasterPanels, opts = {}) {
  return buildPdf({ pages: [sheetPage(dog, rasterPanels, opts)] });
}
