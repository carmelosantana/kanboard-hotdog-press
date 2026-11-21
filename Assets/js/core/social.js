// Social posts from the same eight pages: preset frame sizes, where the page sits in each frame, the ordered frame
// plan, drawing one frame, and the LinkedIn document PDF. Pure, no DOM: the browser makes the canvases, loops over
// socialPlan with renderFrame, encodes PNGs and zips them with zip.js.
import { panelSize, resolvePaper } from './paper.js';
import { colorOf, grayHex } from './looks.js';
import { renderPage, renderSheet } from './render.js';
import { buildPdf, PT_PER_MM } from './pdf.js';

/**
 * Frame sizes in px. `source`: a carousel is every page, cover/pin/story are page 1, sheet is the imposed sheet.
 * @typedef {{w: number, h: number, source: 'pages'|'cover'|'sheet'}} SocialPreset
 */
export const SOCIAL_PRESETS = Object.freeze({
  'carousel-3x4': Object.freeze({ w: 1080, h: 1440, source: 'pages' }),
  'carousel-4x5': Object.freeze({ w: 1080, h: 1350, source: 'pages' }),
  cover: Object.freeze({ w: 1080, h: 1440, source: 'cover' }),
  pin: Object.freeze({ w: 1000, h: 1500, source: 'cover' }),
  story: Object.freeze({ w: 1080, h: 1920, source: 'cover' }),
  sheet: Object.freeze({ w: 2160, h: 1528, source: 'sheet' }),
});

/** The least padding around the page, as a fraction of the frame's shorter side. */
export const SOCIAL_PADDING = 0.06;

const SLUG_MAX = 40;

/**
 * @typedef {{x: number, y: number, w: number, h: number}} Rect integer px within the frame
 * @typedef {{name: string, w: number, h: number, background: string, source: {kind: 'page', index: number}
 *   | {kind: 'sheet'}, rect: Rect}} Frame
 */

/**
 * A file-name-safe slug of a title: lowercase ASCII letters and digits joined by single hyphens, at most 40
 * characters; accents are dropped to their base letter. Nothing left is `zine`.
 * @param {unknown} title
 */
export function slug(title) {
  const s = String(title ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX).replace(/-+$/, '');
  return s || 'zine';
}

/** @param {string} id */
function presetOf(id) {
  if (typeof id !== 'string' || !Object.hasOwn(SOCIAL_PRESETS, id)) throw new Error(`Unknown social preset: ${id}`);
  return SOCIAL_PRESETS[id];
}

/**
 * Where content of `aspect` (width / height) sits in the preset's frame: as large as fits inside an even padding,
 * centred, in whole pixels.
 * @param {string} presetId
 * @param {number} aspect
 * @returns {Rect}
 */
export function frameRect(presetId, aspect) {
  const { w: W, h: H } = presetOf(presetId);
  if (!(aspect > 0 && Number.isFinite(aspect))) throw new Error('frameRect needs a positive finite aspect');
  const pad = Math.round(SOCIAL_PADDING * Math.min(W, H));
  const [iw, ih] = [W - 2 * pad, H - 2 * pad];
  const [w, h] = aspect > iw / ih ? [iw, Math.round(iw / aspect)] : [Math.round(ih * aspect), ih];
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
}

/**
 * The frames of one preset, in posting order. Padding is the look's paper colour.
 * @param {any} dog
 * @param {string} presetId
 * @returns {Frame[]}
 */
export function socialPlan(dog, presetId) {
  const preset = presetOf(presetId);
  const paper = resolvePaper(dog.paper);
  const base = `hotdog-${slug(dog.title)}`;
  const frame = (name, source, aspect) => ({
    name, w: preset.w, h: preset.h, background: colorOf(dog.look, 'paper'), source, rect: frameRect(presetId, aspect),
  });
  if (preset.source === 'sheet') return [frame(`${base}-${presetId}.png`, { kind: 'sheet' }, paper.w_mm / paper.h_mm)];
  const { w, h } = panelSize(paper);
  if (preset.source === 'cover') return [frame(`${base}-${presetId}.png`, { kind: 'page', index: 0 }, w / h)];
  return Array.from({ length: 8 }, (_, i) => frame(`${base}-${presetId}-${String(i + 1).padStart(2, '0')}.png`,
    { kind: 'page', index: i }, w / h));
}

/**
 * Draw one frame onto a context of frame.w x frame.h: the background, then the page (or the sheet, guides on)
 * into frame.rect. With `bw` the background is its gray as well.
 * @param {CanvasRenderingContext2D|any} ctx
 * @param {any} dog
 * @param {Frame} frame
 * @param {{images?: import('./render.js').Images, bw?: boolean}} [opts]
 */
export function renderFrame(ctx, dog, frame, { images = {}, bw = false } = {}) {
  const { rect, source } = frame;
  ctx.save();
  ctx.fillStyle = bw ? grayHex(frame.background) : frame.background;
  ctx.fillRect(0, 0, frame.w, frame.h);
  ctx.translate(rect.x, rect.y);
  if (source.kind === 'sheet') {
    renderSheet(ctx, dog, { px_per_mm: rect.w / resolvePaper(dog.paper).w_mm, images, bw });
  } else {
    renderPage(ctx, dog, source.index, { px_w: rect.w, px_h: rect.h, images, bw });
  }
  ctx.restore();
}

/**
 * The LinkedIn document: 8 pages, each the panel's own size in points, one JPEG filling it, upright, in reading
 * order. No padding.
 * @param {any} dog
 * @param {import('./pdf.js').RasterPanel[]} rasterPanels pages 1..8 in order, in reading orientation
 * @returns {Uint8Array}
 */
export function linkedInPdf(dog, rasterPanels) {
  if (!Array.isArray(rasterPanels) || rasterPanels.length !== 8) {
    throw new Error('linkedInPdf needs 8 panels, pages 1..8 in order');
  }
  const { w, h } = panelSize(dog.paper);
  const [w_pt, h_pt] = [w * PT_PER_MM, h * PT_PER_MM];
  return buildPdf({
    pages: rasterPanels.map(({ jpeg, px_w, px_h }) => ({
      w_pt, h_pt, images: [{ jpeg, px_w, px_h, x_pt: 0, y_pt: 0, w_pt, h_pt }],
    })),
  });
}
