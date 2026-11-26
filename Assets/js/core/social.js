// Social posts from the same eight pages: preset frame sizes, where the page sits in each frame, the ordered frame
// plan, drawing one frame, and the LinkedIn document PDF. Pure, no DOM: the browser makes the canvases, loops over
// socialPlan with renderFrame, encodes PNGs and zips them with zip.js.
import { panelSize, resolvePaper } from './paper.js?v=0.1.2';
import { colorOf, grayHex, lookOf } from './looks.js?v=0.1.2';
import { layoutText, renderPage, renderSheet } from './render.js?v=0.1.2';
import { buildPdf, PT_PER_MM } from './pdf.js?v=0.1.2';

/**
 * Frame sizes in px. `source`: a carousel is every page, cover/pin/story are page 1, sheet is the imposed sheet,
 * bluesky is four picked pages (1, 2, 3 and 8 unless the caller picks).
 * @typedef {{w: number, h: number, source: 'pages'|'cover'|'sheet'|'pick'}} SocialPreset
 */
export const SOCIAL_PRESETS = Object.freeze({
  'carousel-3x4': Object.freeze({ w: 1080, h: 1440, source: 'pages' }),
  'carousel-4x5': Object.freeze({ w: 1080, h: 1350, source: 'pages' }),
  cover: Object.freeze({ w: 1080, h: 1440, source: 'cover' }),
  pin: Object.freeze({ w: 1000, h: 1500, source: 'cover' }),
  story: Object.freeze({ w: 1080, h: 1920, source: 'cover' }),
  sheet: Object.freeze({ w: 2160, h: 1528, source: 'sheet' }),
  bluesky: Object.freeze({ w: 1080, h: 1440, source: 'pick' }),
});

/** Bluesky's default pick: the cover, the first spread and the back. */
const BLUESKY_PAGES = Object.freeze([1, 2, 3, 8]);

/** The least padding around the page, as a fraction of the frame's shorter side. */
export const SOCIAL_PADDING = 0.06;

/** A story caption's band at the foot of the frame, as a fraction of the frame height. */
export const STORY_CAPTION_BAND = 0.18;
/** The caption's font size as a fraction of its box height: two lines of the display font fit (textfit.js). */
export const CAPTION_SIZE = 0.36;

const SLUG_MAX = 40;

/**
 * @typedef {{x: number, y: number, w: number, h: number}} Rect integer px within the frame
 * @typedef {{name: string, w: number, h: number, background: string, source: {kind: 'page', index: number}
 *   | {kind: 'sheet'}, rect: Rect, caption?: {text: string, rect: Rect}}} Frame
 *   `caption` only on a story given one: the page sits above it.
 */

/**
 * A file-name-safe slug of a title: lowercase ASCII letters and digits joined by single hyphens, at most 40
 * characters; accents are dropped to their base letter. Nothing left is `zine`.
 * @param {unknown} title
 */
export function slug(title) {
  const s = String(title ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
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
  return fit(W, H, aspect, padOf(W, H));
}

const padOf = (W, H) => Math.round(SOCIAL_PADDING * Math.min(W, H));

/** Content of `aspect` fitted inside `pad` in a W x H area at the origin, centred, in whole pixels. */
function fit(W, H, aspect, pad) {
  if (!(aspect > 0 && Number.isFinite(aspect))) throw new Error('frameRect needs a positive finite aspect');
  const [iw, ih] = [W - 2 * pad, H - 2 * pad];
  const [w, h] = aspect > iw / ih ? [iw, Math.round(iw / aspect)] : [Math.round(ih * aspect), ih];
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
}

/** @param {unknown} pages */
function pickedPages(pages) {
  const ok = Array.isArray(pages) && pages.length === 4 && new Set(pages).size === 4
    && pages.every((n) => Number.isInteger(n) && n >= 1 && n <= 8);
  if (!ok) throw new Error('bluesky needs exactly 4 distinct pages, numbers 1..8');
  return pages;
}

/** The trimmed caption, or undefined when there is none. @param {unknown} caption */
function captionText(caption) {
  if (caption === undefined || caption === null) return undefined;
  if (typeof caption !== 'string') throw new Error('A story caption must be a string');
  return caption.trim() || undefined;
}

/**
 * The frames of one preset, in posting order. Padding is the look's paper colour.
 * - `caption` (story only): the page is fitted above a band at the foot of the frame and the caption sits in it.
 *   A blank caption is none.
 * - `pages` (bluesky only): the 4 page numbers to post, in order; default 1, 2, 3, 8.
 * @param {any} dog
 * @param {string} presetId
 * @param {{caption?: string, pages?: number[]}} [opts]
 * @returns {Frame[]}
 */
export function socialPlan(dog, presetId, { caption, pages } = {}) {
  const preset = presetOf(presetId);
  if (pages !== undefined && preset.source !== 'pick') throw new Error('pages is only for bluesky');
  if (caption !== undefined && presetId !== 'story') throw new Error('caption is only for story');
  const paper = resolvePaper(dog.paper);
  const base = `hotdog-${slug(dog.title)}`;
  const frame = (name, source, aspect) => ({
    name, w: preset.w, h: preset.h, background: colorOf(dog.look, 'paper'), source, rect: frameRect(presetId, aspect),
  });
  if (preset.source === 'sheet') return [frame(`${base}-${presetId}.png`, { kind: 'sheet' }, paper.w_mm / paper.h_mm)];
  const { w, h } = panelSize(paper);
  const text = captionText(caption);
  if (text) {
    const { w: W, h: H } = preset;
    const pad = padOf(W, H);
    const band = Math.round(STORY_CAPTION_BAND * H);
    return [{
      ...frame(`${base}-${presetId}.png`, { kind: 'page', index: 0 }, w / h),
      rect: fit(W, H - band, w / h, pad),
      caption: { text, rect: { x: pad, y: H - band, w: W - 2 * pad, h: band - pad } },
    }];
  }
  if (preset.source === 'cover') return [frame(`${base}-${presetId}.png`, { kind: 'page', index: 0 }, w / h)];
  const numbers = preset.source === 'pick' ? pickedPages(pages ?? BLUESKY_PAGES) : [1, 2, 3, 4, 5, 6, 7, 8];
  return numbers.map((n, i) => frame(`${base}-${presetId}-${String(i + 1).padStart(2, '0')}.png`,
    { kind: 'page', index: n - 1 }, w / h));
}

/**
 * Draw one frame onto a context of frame.w x frame.h: the background, then the page (or the sheet, guides on)
 * into frame.rect, then any caption. With `bw` the background and caption are their grays as well.
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
  if (frame.caption) drawCaption(ctx, dog, frame.caption, bw);
}

/**
 * The caption centred in its box: the look's display font, its text colour, wrapped by render.js's layoutText;
 * lines past the box height are dropped.
 */
function drawCaption(ctx, dog, { text, rect }, bw) {
  const item = { font: 'display', size: CAPTION_SIZE, w: 1, h: 1, runs: [{ text }] };
  const layout = layoutText(ctx, item, rect.w, rect.h, dog.look);
  const block = layout.visible > 0 ? layout.ascent_px + layout.descent_px + (layout.visible - 1) * layout.line_px : 0;
  const top = rect.y + (rect.h - block) / 2 + layout.ascent_px;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.fillStyle = colorOf(dog.look, lookOf(dog.look).text, bw);
  for (let i = 0; i < layout.visible; i++) ctx.fillText(layout.lines[i], rect.x + rect.w / 2, top + i * layout.line_px);
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
