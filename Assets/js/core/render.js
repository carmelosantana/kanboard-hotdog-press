// The renderer: a Dog page, or the whole print sheet, drawn onto any 2D-canvas-like context. The editor preview,
// the PDF rasteriser and the social frames all draw through here. Pure, no DOM: the caller hands in the context and
// the decoded images; nothing here loads fonts or files.
import { panelRect } from './impose.js';
import { LINE_HEIGHT, linesThatFit, metricsOf, wrapText } from './textfit.js';
import { joinRuns } from './runs.js';
import { colorOf, grayHex, grayLevelHex, lookOf } from './looks.js';
import { resolvePaper } from './paper.js';
import { guideLines, PT_PER_MM } from './pdf.js';

export { LOOKS, TOKENS, colorOf } from './looks.js';

/** Neutral stand-in for an image that is missing, a placeholder, or not decoded. */
const PLACEHOLDER = Object.freeze({ fill: '#E4E1DA', line: '#9A968C' });
/** Defaults when an item leaves a width out, in panel-width units. */
const DEFAULT_INK_WIDTH = 0.006;
const DEFAULT_STROKE_WIDTH = 0.004;
const ALIGNS = ['left', 'center', 'right'];

/**
 * @typedef {{width: number, height: number}} Drawable anything ctx.drawImage accepts (ImageBitmap, canvas, img)
 * @typedef {Record<string, Drawable>} Images decoded images by asset id
 * @typedef {{font: string, size_px: number, line_px: number, ascent_px: number, descent_px: number,
 *   lines: string[], visible: number, overflow: boolean}} TextLayout
 */

/**
 * Draw page `pageIndex` (0..7) of the Dog into the context's 0,0..px_w,px_h, clipped to it: the background, then the
 * items in array order. Geometry is in panel units, font sizes in panel-height units, ink and stroke widths in
 * panel-width units, `rot` in degrees clockwise about the item's centre.
 *
 * With `bw` every colour is drawn as its luminance gray; photos are drawn as they are, so the browser runs
 * filters.toGray (and optionally levels) over the rendered ImageData to finish the black-and-white page.
 * A missing, placeholder or undecoded image draws a neutral box with a cross; nothing here throws on assets.
 *
 * @param {CanvasRenderingContext2D|any} ctx
 * @param {any} dog
 * @param {number} pageIndex
 * @param {{px_w: number, px_h: number, images?: Images, bw?: boolean}} opts
 */
export function renderPage(ctx, dog, pageIndex, { px_w, px_h, images = {}, bw = false }) {
  const page = Number.isInteger(pageIndex) ? dog.pages?.[pageIndex] : undefined;
  if (!page) throw new RangeError(`No page at index ${pageIndex}`);
  const color = (token) => colorOf(dog.look, token, bw);
  const paint = (hex) => (bw ? grayHex(hex) : hex);
  const env = { ctx, dog, px_w, px_h, images: images ?? {}, color, paint };

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, px_w, px_h);
  ctx.clip();
  ctx.fillStyle = color(Object.hasOwn(lookOf(dog.look).colors, page.bg) ? page.bg : 'paper');
  ctx.fillRect(0, 0, px_w, px_h);
  for (const item of Array.isArray(page.items) ? page.items : []) {
    const draw = DRAW[item?.type];
    if (!draw) continue;
    ctx.save();
    turn(ctx, item, px_w, px_h);
    draw(item, env);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Draw the print sheet at `px_per_mm`: each page through renderPage into its quarter (the top row turned 180°),
 * then, with guides on, the print export's guide layer (folds, cut, page ticks, check square) in its print styles and
 * the look's guide level. Guide strokes are at least 1 px wide, so they stay visible at small preview scales.
 * @param {CanvasRenderingContext2D|any} ctx
 * @param {any} dog
 * @param {{px_per_mm: number, images?: Images, guides?: boolean, bw?: boolean}} opts
 */
export function renderSheet(ctx, dog, { px_per_mm: k, images = {}, guides = true, bw = false }) {
  const paper = resolvePaper(dog.paper);
  for (let i = 0; i < 8; i++) {
    const r = panelRect(paper, i + 1);
    const [w, h] = [r.w * k, r.h * k];
    ctx.save();
    ctx.translate(r.x * k, r.y * k);
    if (r.rotate === 180) {
      ctx.translate(w, h);
      ctx.rotate(Math.PI);
    }
    renderPage(ctx, dog, i, { px_w: w, px_h: h, images, bw });
    ctx.restore();
  }
  if (!guides) return;
  // Guide lines are in PDF points from the bottom-left corner; the canvas is px from the top-left.
  const px = (pt) => (pt / PT_PER_MM) * k;
  const H = paper.h_mm * k;
  for (const l of guideLines(dog)) {
    ctx.save();
    ctx.lineWidth = Math.max(1, px(l.width_pt ?? 1));
    ctx.strokeStyle = grayLevelHex(l.gray ?? 0);
    ctx.setLineDash((l.dash ?? []).map(px));
    ctx.beginPath();
    ctx.moveTo(px(l.x1), H - px(l.y1));
    ctx.lineTo(px(l.x2), H - px(l.y2));
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Wrap a text item's runs to its box: greedy by words, measured with ctx.measureText at the item's font (it sets
 * ctx.font), breaking at newlines and between the runs of a list item (runs.js), and splitting words wider than the box.
 * `visible` counts the lines that fit the box height by textfit.js's rule (the first line needs the font's accent
 * ascent + descent, each further one LINE_HEIGHT); the rest are not drawn (except a first line in a box too short for
 * it, drawn clipped), and `overflow` says so. Lines are drawn on
 * alphabetic baselines, the first `ascent_px` below the box top.
 * @param {CanvasRenderingContext2D|any} ctx
 * @param {any} item
 * @param {number} px_w
 * @param {number} px_h
 * @param {string} [lookName]
 * @returns {TextLayout}
 */
export function layoutText(ctx, item, px_w, px_h, lookName = 'kraft') {
  const fonts = lookOf(lookName).fonts;
  const size_px = num(item.size, 0) * px_h;
  const font = `${round(size_px)}px ${Object.hasOwn(fonts, item.font) ? fonts[item.font] : fonts.body}`;
  const line_px = size_px * LINE_HEIGHT;
  const box_w = num(item.w, 0) * px_w;
  const box_h = num(item.h, 0) * px_h;
  ctx.font = font;
  const fits = (s) => ctx.measureText(s).width <= box_w;

  const lines = wrapText(joinRuns(item), fits);
  const visible = Math.min(lines.length, linesThatFit(box_h, size_px, item.font));
  const { ascent, descent } = metricsOf(item.font);
  return {
    font, size_px, line_px, ascent_px: ascent * size_px, descent_px: descent * size_px, lines, visible,
    overflow: visible < lines.length,
  };
}

// ---------------------------------------------------------------- items

const DRAW = {
  text(item, { ctx, dog, px_w, px_h, color }) {
    const b = box(item, px_w, px_h);
    const layout = layoutText(ctx, item, px_w, px_h, dog.look);
    const align = ALIGNS.includes(item.align) ? item.align : 'left';
    clipTo(ctx, b);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = align;
    ctx.fillStyle = color(item.color);
    const x = align === 'center' ? b.x + b.w / 2 : align === 'right' ? b.x + b.w : b.x;
    const top = b.y + layout.ascent_px;
    // A box too short for one whole line still shows its first line, cut by the clip, so text never vanishes.
    const drawn = Math.max(layout.visible, Math.min(1, layout.lines.length));
    for (let i = 0; i < drawn; i++) ctx.fillText(layout.lines[i], x, top + i * layout.line_px);
  },

  image(item, env) {
    picture(item, env, item.fit === 'contain' ? 'contain' : 'cover', item.focus, item.crop);
  },

  sticker(item, env) {
    picture(item, env, 'contain');
  },

  shape(item, { ctx, px_w, px_h, color }) {
    const b = box(item, px_w, px_h);
    ctx.beginPath();
    if (item.shape === 'ellipse') ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, 2 * Math.PI);
    else ctx.rect(b.x, b.y, b.w, b.h);
    if (isToken(item.fill)) {
      ctx.fillStyle = color(item.fill);
      ctx.fill();
    }
    if (isToken(item.stroke)) {
      ctx.strokeStyle = color(item.stroke);
      ctx.lineWidth = num(item.stroke_width, DEFAULT_STROKE_WIDTH) * px_w;
      ctx.stroke();
    }
  },

  ink(item, { ctx, px_w, px_h, color }) {
    const pts = inkPoints(item);
    if (pts.length === 0) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = num(item.width, DEFAULT_INK_WIDTH) * px_w;
    ctx.strokeStyle = color(item.color);
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * px_w, pts[0][1] * px_h);
    // A single point is a zero-length segment, which round caps draw as a dot.
    for (const [x, y] of pts.length === 1 ? pts : pts.slice(1)) ctx.lineTo(x * px_w, y * px_h);
    ctx.stroke();
  },
};

/** An image or sticker: the decoded image fitted into the box and clipped to it, or the placeholder. */
function picture(item, { ctx, dog, px_w, px_h, images, paint }, fit, focus, crop) {
  const b = box(item, px_w, px_h);
  const asset = dog.assets?.[item.asset];
  const img = typeof item.asset === 'string' && Object.hasOwn(images, item.asset) ? images[item.asset] : undefined;
  if (!asset || asset.kind === 'placeholder' || !img || !(img.width > 0 && img.height > 0)) {
    placeholder(ctx, b, paint);
    return;
  }
  const [cx, cy, cw, ch] = validCrop(crop) ? crop : [0, 0, 1, 1];
  const [sx, sy, sw, sh] = [cx * img.width, cy * img.height, cw * img.width, ch * img.height];
  const scale = (fit === 'contain' ? Math.min : Math.max)(b.w / sw, b.h / sh);
  const [dw, dh] = [sw * scale, sh * scale];
  let dx = b.x + (b.w - dw) / 2;
  let dy = b.y + (b.h - dh) / 2;
  if (fit === 'cover') {
    // Put the focus point on the box centre, as far as the image still covers the box.
    const [fx, fy] = Array.isArray(focus) ? focus.map((v) => clamp(num(v, 0.5), 0, 1)) : [0.5, 0.5];
    dx = clamp(b.x + b.w / 2 - fx * dw, b.x + b.w - dw, b.x);
    dy = clamp(b.y + b.h / 2 - fy * dh, b.y + b.h - dh, b.y);
  }
  clipTo(ctx, b);
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function placeholder(ctx, b, paint) {
  ctx.fillStyle = paint(PLACEHOLDER.fill);
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = paint(PLACEHOLDER.line);
  ctx.lineWidth = Math.max(1, Math.min(b.w, b.h) * 0.005);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x + b.w, b.y + b.h);
  ctx.moveTo(b.x + b.w, b.y);
  ctx.lineTo(b.x, b.y + b.h);
  ctx.stroke();
  ctx.strokeRect(b.x, b.y, b.w, b.h);
}

/** Rotate the context by the item's `rot` (degrees clockwise) about its centre; ink without a box uses its points. */
function turn(ctx, item, px_w, px_h) {
  const deg = num(item.rot, 0);
  if (deg === 0) return;
  let c;
  if (item.type === 'ink' && item.x === undefined) {
    const pts = inkPoints(item);
    if (pts.length === 0) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    c = [((Math.min(...xs) + Math.max(...xs)) / 2) * px_w, ((Math.min(...ys) + Math.max(...ys)) / 2) * px_h];
  } else {
    const b = box(item, px_w, px_h);
    c = [b.x + b.w / 2, b.y + b.h / 2];
  }
  ctx.translate(c[0], c[1]);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.translate(-c[0], -c[1]);
}

// ---------------------------------------------------------------- helpers

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v * 100) / 100;
const isToken = (v) => typeof v === 'string' && v !== '' && v !== 'none';
const box = (item, px_w, px_h) => ({
  x: num(item.x, 0) * px_w, y: num(item.y, 0) * px_h, w: num(item.w, 0) * px_w, h: num(item.h, 0) * px_h,
});
const inkPoints = (item) => (Array.isArray(item.points) ? item.points : [])
  .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
const validCrop = (c) => Array.isArray(c) && c.length === 4 && c.every((v) => Number.isFinite(v))
  && c[0] >= 0 && c[1] >= 0 && c[2] > 0 && c[3] > 0 && c[0] + c[2] <= 1 && c[1] + c[3] <= 1;

function clipTo(ctx, b) {
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w, b.h);
  ctx.clip();
}
