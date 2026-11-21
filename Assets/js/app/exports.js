// The export files, made in the browser: the 300 dpi print PDF, the LinkedIn PDF, and the social frames (one PNG, or a
// ZIP of PNGs). Pages are drawn by core/render.js onto canvases; in black and white the drawn pixels then go through
// core/filters.js (toGray, then levels) before they are encoded. Canvases and the encoder can be handed in, so this
// runs under Node for the tests; in the browser they default to <canvas> and toBlob.
import { toGray, levels } from '../core/filters.js';
import { renderPage } from '../core/render.js';
import { exportPdf } from '../core/pdf.js';
import { linkedInPdf, renderFrame, slug, socialPlan } from '../core/social.js';
import { panelSize } from '../core/paper.js';
import { zipStore } from '../core/zip.js';

export const PRINT_DPI = 300;
export const JPEG_QUALITY = 0.9;
/** Photocopier contrast for black and white: grays at or below `black` print solid, at or above `white` blank. */
export const BW_LEVELS = Object.freeze({ black: 16, white: 240 });

/**
 * @typedef {{width: number, height: number, getContext(type: '2d'): any}} CanvasLike
 * @typedef {{canvas?: (w: number, h: number) => CanvasLike,
 *   encode?: (canvas: CanvasLike, type: string, quality?: number) => Promise<Uint8Array>}} Surface
 * @typedef {{name: string, type: string, data: Uint8Array}} ExportFile
 */

/** @type {(w: number, h: number) => CanvasLike} */
const domCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

/** @type {(canvas: any, type: string, quality?: number) => Promise<Uint8Array>} */
async function toBytes(canvas, type, quality) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error(`Hot Dog Press: the browser could not encode ${type}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  canvas.width = 0; // hand the pixels back now; a 300 dpi sheet is eight large canvases
  return bytes;
}

/** A panel's size in px at `dpi`. @param {any} paper */
export function panelPixels(paper, dpi = PRINT_DPI) {
  const { w, h } = panelSize(paper);
  return { px_w: Math.round((w / 25.4) * dpi), px_h: Math.round((h / 25.4) * dpi) };
}

/**
 * The black-and-white finish: grayscale and photocopier levels over the drawn pixels, put back in place.
 * @param {any} ctx @param {number} w @param {number} h
 */
export function finishBw(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  levels(toGray(img), BW_LEVELS.black, BW_LEVELS.white);
  ctx.putImageData(img, 0, 0);
}

/** Draws with `paint(ctx)` on a fresh w x h canvas, finishes B&W if asked, and encodes it. */
async function draw(w, h, paint, type, quality, { bw = false, canvas = domCanvas, encode = toBytes }) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  paint(ctx);
  if (bw) finishBw(ctx, w, h);
  return encode(c, type, quality);
}

/**
 * Pages 1..8 as JPEG panels in reading orientation, at `dpi`.
 * @param {any} dog @param {Record<string, any>} images decoded images by asset id
 * @param {Surface & {bw?: boolean, dpi?: number}} [opts]
 * @returns {Promise<import('../core/pdf.js').RasterPanel[]>}
 */
export async function rasterPanels(dog, images, { dpi = PRINT_DPI, ...opts } = {}) {
  const { px_w, px_h } = panelPixels(dog.paper, dpi);
  const panels = [];
  for (let i = 0; i < 8; i++) {
    const jpeg = await draw(px_w, px_h, (ctx) => renderPage(ctx, dog, i, { px_w, px_h, images, bw: opts.bw }),
      'image/jpeg', JPEG_QUALITY, opts);
    panels.push({ jpeg, px_w, px_h });
  }
  return panels;
}

/** @param {any} dog */
export const printName = (dog) => `hotdog-${slug(dog.title)}-${dog.paper}.pdf`;

/**
 * The print PDF: one landscape sheet at the paper size.
 * @param {any} dog @param {Record<string, any>} images
 * @param {Surface & {bw?: boolean, guides?: boolean}} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function printPdf(dog, images, { guides = true, ...opts } = {}) {
  return exportPdf(dog, await rasterPanels(dog, images, opts), { guides });
}

/**
 * The LinkedIn document: 8 upright pages.
 * @param {any} dog @param {Record<string, any>} images @param {Surface & {bw?: boolean}} [opts]
 * @returns {Promise<ExportFile>}
 */
export async function linkedInFile(dog, images, opts = {}) {
  return {
    name: `hotdog-${slug(dog.title)}-linkedin.pdf`,
    type: 'application/pdf',
    data: linkedInPdf(dog, await rasterPanels(dog, images, opts)),
  };
}

/**
 * A social preset: one PNG for a single frame, else a ZIP of the frames in posting order.
 * @param {any} dog @param {string} presetId a key of SOCIAL_PRESETS
 * @param {Record<string, any>} images
 * @param {Surface & {bw?: boolean, caption?: string, pages?: number[]}} [opts]
 * @returns {Promise<ExportFile>}
 */
export async function socialFiles(dog, presetId, images, { caption, pages, ...opts } = {}) {
  const frames = socialPlan(dog, presetId, { caption, pages });
  const files = [];
  for (const frame of frames) {
    const data = await draw(frame.w, frame.h, (ctx) => renderFrame(ctx, dog, frame, { images, bw: opts.bw }),
      'image/png', undefined, opts);
    files.push({ name: frame.name, data });
  }
  if (files.length === 1) return { ...files[0], type: 'image/png' };
  return { name: `hotdog-${slug(dog.title)}-${presetId}.zip`, type: 'application/zip', data: zipStore(files) };
}
