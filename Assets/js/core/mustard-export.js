// Export: a Dog written back as Mustard, in the Dog's own item order (z-order). Never throws, whatever the Dog holds:
// missing numbers are left out, ids an attribute block cannot carry are re-minted with a warning. Pure, no DOM.
import { randomId, LAYOUT_NAMES, PAPER_IDS, BY_VALUES } from './dog.js?v=0.1.0';
import { LAYOUTS, place, BULLET } from './layouts.js?v=0.1.0';
import { DEFAULT_MARGIN_MM, MAX_MARGIN_MM } from './paper.js?v=0.1.0';
import { yamlScalar } from './frontmatter.js?v=0.1.0';
import {
  MUSTARD_VERSION, KEPT_TYPES, KEY, canName, attrValue, formatImage, markdownLines, routeBlock,
} from './mustard-syntax.js?v=0.1.0';
import { isListItem } from './runs.js?v=0.1.0';

const BOX = ['x', 'y', 'w', 'h'];
const EPS = 1e-6;
/** Keys compile reads itself, so a free-form attribute by these names would not come back as one. */
const RESERVED = ['slot', 'by', 'locked', 'focus'];
const GEOMETRY = [...BOX, 'rot'];
const KEPT_NOTE = '# Exported from Hot Dog Press. Ink, stickers and shapes are listed in kept: and come back only '
  + 'when this is re-imported into the same zine.';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * A Dog as Mustard. Items keep their order; slot items become markdown, moved items get `{.place}`, every item gets
 * `{#id}`; ink, stickers and shapes cannot be written and are listed (page order) in `kept`. Text styles, crops and
 * rich runs are not kept.
 * @param {object} dog
 * @returns {{text: string, kept: string[], warnings: {path: string, message: string}[]}}
 */
export function exportMustard(dog) {
  const d = isObject(dog) ? dog : {};
  const kept = [];
  const warnings = [];
  const inRange = finite(d.margin_mm) && d.margin_mm >= 0 && d.margin_mm <= MAX_MARGIN_MM;
  const margin = inRange ? d.margin_mm : DEFAULT_MARGIN_MM;
  const env = {
    assets: isObject(d.assets) ? d.assets : {},
    paper: PAPER_IDS.includes(d.paper) ? d.paper : 'letter',
    margin,
    kept,
    warn: (path, message) => warnings.push({ path, message }),
  };
  const pages = (Array.isArray(d.pages) ? d.pages : [])
    .map((page, p) => exportPage(isObject(page) ? page : {}, p, env));

  const front = ['---'];
  if (kept.length) front.push(KEPT_NOTE);
  front.push(`mustard: ${MUSTARD_VERSION}`, `title: ${yamlScalar(typeof d.title === 'string' ? d.title : '')}`);
  if (typeof d.issue === 'string' || finite(d.issue)) front.push(`issue: ${yamlScalar(d.issue)}`);
  front.push(`paper: ${env.paper}`);
  if (margin !== DEFAULT_MARGIN_MM) front.push(`margin_mm: ${margin}`);
  front.push(`look: ${yamlScalar(typeof d.look === 'string' && d.look !== '' ? d.look : 'kraft')}`);
  if (kept.length) front.push(`kept: [${kept.map(yamlScalar).join(', ')}]`);
  front.push('---');
  return { text: `${[front.join('\n'), ...pages].join('\n\n')}\n`, kept, warnings };
}

function exportPage(page, p, env) {
  const layout = LAYOUT_NAMES.includes(page.layout) ? page.layout : 'freeform';
  const defs = LAYOUTS[layout].slots;
  const items = Array.isArray(page.items) ? page.items : [];

  const head = [`layout=${layout}`];
  if (page.id !== undefined && page.id !== `p${p + 1}`) {
    if (canName(page.id)) head.unshift(`#${page.id}`);
    else {
      env.warn(`pages/${p}/id`, `page id ${JSON.stringify(page.id)} cannot be written in an attribute block; left out`);
    }
  }
  if (typeof page.bg === 'string' && page.bg !== 'paper') head.push(`bg=${attrValue(page.bg)}`);

  // The first item of a matching kind in each slot fills it; the rest are free.
  const bySlot = new Map();
  for (const item of items) {
    if (!isObject(item) || KEPT_TYPES.includes(item.type)) continue;
    const def = defs.find((s) => s.name === item.slot);
    if (def && !bySlot.has(def.name) && (def.kind === 'image') === (item.type === 'image')) bySlot.set(def.name, item);
  }

  const ctx = { env, layout, defs, opts: { margin_mm: env.margin, page: p + 1 } };
  const filled = new Set();
  const blocks = [];
  items.forEach((item, i) => {
    const path = `pages/${p}/items/${i}`;
    if (!isObject(item)) return;
    if (KEPT_TYPES.includes(item.type)) {
      if (typeof item.id === 'string' && item.id !== '') env.kept.push(item.id);
      else env.warn(`${path}/id`, `this ${item.type} has no id, so it cannot be kept`);
      return;
    }
    const id = itemId(item, path, env);
    const def = defs.find((s) => bySlot.get(s.name) === item);
    blocks.push(def
      ? slotBlock(item, id, path, def, filled, ctx)
      : freeBlock(item, id, path, layout !== 'freeform', ctx));
    if (def) filled.add(def.name);
  });
  return [`::: page {${head.join(' ')}}`, ...(blocks.length ? [blocks.join('\n\n')] : []), ':::'].join('\n');
}

function itemId(item, path, env) {
  if (canName(item.id)) return item.id;
  const stem = [item.slot, item.type].find(canName) ?? 'item';
  const fresh = `${stem}_${randomId()}`;
  env.warn(`${path}/id`, item.id === undefined
    ? `item has no id; exported as ${fresh}`
    : `id ${JSON.stringify(item.id)} cannot be written in an attribute block; exported as ${fresh}`);
  return fresh;
}

function slotBlock(item, id, path, def, filled, ctx) {
  const texts = runTexts(item);
  let kind = 'paragraph';
  if (def.kind === 'image') kind = 'image';
  else if (def.kind === 'list') kind = texts.length ? 'list' : 'paragraph';
  else if (def.name === 'title' && !texts.join('').includes('\n')) kind = 'heading';
  else if (def.name === 'quote') kind = 'quote';
  // Compile routes a block by kind to the first open slot; name the slot when that would be a different one.
  const pinned = routeBlock(kind, ctx.defs, (name) => filled.has(name))?.name !== def.name;
  const attrs = itemAttrs(item, id, path, ctx.env, { slot: pinned ? def.name : null, placed: moved(item, def, ctx) });
  return writeBlock(kind, item, texts, attrs, ctx.env);
}

function freeBlock(item, id, path, markFree, ctx) {
  const texts = runTexts(item);
  const text = texts.join('');
  let kind = 'paragraph';
  if (item.type === 'image') kind = 'image';
  else if (isListItem(item)) kind = 'list';
  else if (item.font === 'display' && item.align === 'center') kind = 'quote';
  else if (item.font === 'display' && !text.includes('\n')) kind = 'heading';
  return writeBlock(kind, item, texts, itemAttrs(item, id, path, ctx.env, { free: markFree, placed: true }), ctx.env);
}

function writeBlock(kind, item, texts, attrs, env) {
  const text = texts.join('');
  if (kind === 'image') return `${formatImage(altOf(item), imageName(item, env))}${attrs}`;
  if (kind === 'list') {
    const oneLine = (t) => t.replace(new RegExp(`^${BULLET}\\s?`), '').split('\n').map((l) => l.trim()).join(' ');
    const lines = texts.map((t) => `- ${oneLine(t)}`);
    lines[lines.length - 1] += ` ${attrs}`;
    return lines.join('\n');
  }
  if (kind === 'heading') return `# ${text} ${attrs}`;
  const lines = withAttrs(markdownLines(text), attrs);
  return (kind === 'quote' ? lines.map((l) => `> ${l}`) : lines).join('\n');
}

function withAttrs(lines, attrs) {
  const out = [...lines];
  out[out.length - 1] = out[out.length - 1] === '' ? attrs : `${out[out.length - 1]} ${attrs}`;
  return out;
}

/** Whether an item sits anywhere but where its slot would put it on this page (missing numbers do not count). */
function moved(item, def, ctx) {
  const dummy = def.kind === 'image' ? { asset: 'x' } : def.kind === 'list' ? { items: [] } : { text: '' };
  const [home] = place(ctx.layout, { [def.name]: dummy }, ctx.env.paper, ctx.opts);
  return BOX.some((k) => finite(item[k]) && !(Math.abs(item[k] - home[k]) < EPS));
}

function itemAttrs(item, id, path, env, { slot = null, placed = false, free = false }) {
  const parts = [`#${id}`];
  if (free) parts.push('.free');
  const box = placed ? BOX.filter((k) => finite(item[k])) : [];
  const rot = finite(item.rot) && item.rot !== 0;
  const geo = box.length > 0 || rot;
  if (geo) parts.push('.place');

  const attrs = isObject(item.attrs) ? item.attrs : {};
  if (attrs.class !== undefined) {
    const cls = String(attrs.class);
    const tokens = cls.split(' ');
    // `.a .b` reads back as "a b"; anything else (odd spacing, dots, place/free) goes as class="…".
    const plain = cls !== '' && tokens.every((t) => canName(t) && t !== 'place' && t !== 'free');
    parts.push(...(plain ? tokens.map((t) => `.${t}`) : [`class=${attrValue(cls)}`]));
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class' || (k === 'alt' && item.type === 'image')) continue;
    if (!KEY.test(k) || RESERVED.includes(k) || (geo && GEOMETRY.includes(k))) {
      env.warn(`${path}/attrs`, `attribute ${JSON.stringify(k)} cannot be written back; left out`);
      continue;
    }
    parts.push(`${k}=${attrValue(String(v))}`);
  }
  if (geo) {
    parts.push(...box.map((k) => `${k}=${num(item[k])}`));
    if (rot) parts.push(`rot=${num(item.rot)}`);
  }
  if (slot) parts.push(`slot=${slot}`);
  if (BY_VALUES.includes(item.by) && item.by !== 'import') parts.push(`by=${item.by}`);
  if (item.locked === true) parts.push('locked=true');
  const f = item.focus;
  const focus = Array.isArray(f) && f.length === 2 && f.every(finite);
  if (item.type === 'image' && focus && (f[0] !== 0.5 || f[1] !== 0.5)) {
    parts.push(`focus=${f.map(num).join(',')}`);
  }
  return `{${parts.join(' ')}}`;
}

function imageName(item, env) {
  if (typeof item.asset !== 'string') return '';
  const asset = env.assets[item.asset];
  if (typeof asset?.name === 'string' && asset.name !== '') return asset.name;
  if (asset?.file_id != null) return `file:${asset.file_id}`;
  return item.asset;
}

const altOf = (item) => (item.attrs?.alt === undefined ? '' : String(item.attrs.alt));
const runTexts = (item) => (Array.isArray(item.runs)
  ? item.runs.map((r) => (typeof r?.text === 'string' ? r.text : ''))
  : []);

/** Six decimals: well inside the 1e-6 a round trip keeps; tiny non-zero values keep full precision. */
function num(n) {
  const r = Number(n.toFixed(6));
  return String(r !== 0 || n === 0 ? r : n);
}
