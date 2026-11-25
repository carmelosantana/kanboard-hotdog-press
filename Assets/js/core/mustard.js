// Mustard (*.mustard.md): markdown for writing a zine. compileMustard turns it into the Dog (deterministic apart from
// minted ids); exportMustard (mustard-export.js) writes a Dog back. Pure, no DOM. Format: hotdogpress-formats.md.
import { newDog, validateDog, randomId, LAYOUT_NAMES, BY_VALUES, PAPER_IDS, MAX_DOG_BYTES } from './dog.js?v=0.1.1';
import { LAYOUTS, place, budget, overflows, BULLET } from './layouts.js?v=0.1.1';
import { safeArea } from './impose.js?v=0.1.1';
import { DEFAULT_MARGIN_MM, MAX_MARGIN_MM } from './paper.js?v=0.1.1';
import { readFrontMatter } from './frontmatter.js?v=0.1.1';
import {
  MUSTARD_VERSION, emptyAttrs, parseAttrs, splitAttrs, parseImage, unescapeLine, inline, isPara, routeBlock,
} from './mustard-syntax.js?v=0.1.1';

export { MUSTARD_VERSION } from './mustard-syntax.js?v=0.1.1';
export { exportMustard } from './mustard-export.js?v=0.1.1';

/** @typedef {{path: string, message: string, line?: number}} MustardProblem */

const PAGE_COUNT = 8;
/** Mustard text is refused above the Dog's own size limit (UTF-8 bytes). */
export const MAX_MUSTARD_BYTES = MAX_DOG_BYTES;
/** The error for Mustard over MAX_MUSTARD_BYTES. */
export const MUSTARD_TOO_LARGE = `must be at most ${MAX_MUSTARD_BYTES} bytes of Mustard`;
const FRONT_KEYS = ['mustard', 'title', 'issue', 'paper', 'look', 'margin_mm', 'kept'];
/** Keys that move an item; they act only next to `.place`. */
const GEOMETRY = ['x', 'y', 'w', 'h', 'rot'];
/** A block with no slot borrows the style of the slot its kind normally fills: [layout, slot]. */
const FREE_STYLE = {
  heading: ['headline-body', 'title'],
  paragraph: ['headline-body', 'body'],
  quote: ['quote', 'quote'],
  list: ['list', 'list'],
};
const NUMERIC_ID = /^[0-9]+$/;

/**
 * Mustard text to a Dog. Problems never throw: errors make the Dog unfit to save, warnings are for the editor.
 * The Dog is always eight pages and, when there are no errors, passes validateDog strict.
 * @param {string} text
 * @param {{paper?: string, assets?: Record<string, object>, from?: object}} [opts] paper is the default when the
 *   front matter has none; assets are the zine's known files (matched by id, name or `file:<file_id>`); from is the
 *   zine being re-imported into, whose `kept:` items come back.
 * @returns {{dog: object, warnings: MustardProblem[], errors: MustardProblem[]}}
 */
export function compileMustard(text, { paper, assets = {}, from } = {}) {
  const warnings = [];
  const errors = [];
  const note = (list) => (path, message, line) => list.push(line ? { path, message, line } : { path, message });
  const warn = note(warnings);
  const fail = note(errors);

  const source = String(text);
  if (source.length > MAX_MUSTARD_BYTES || new TextEncoder().encode(source).length > MAX_MUSTARD_BYTES) {
    fail('', MUSTARD_TOO_LARGE);
    return { dog: newDog({ paper: PAPER_IDS.includes(paper) ? paper : 'letter' }), warnings, errors };
  }
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const { meta, start } = readFrontMatter(lines, warn);
  const fm = readMeta(meta, paper, warn, fail);
  const dog = newDog({ title: fm.title, paper: fm.paper });
  dog.margin_mm = fm.margin_mm;
  dog.look = fm.look;
  if (fm.issue !== undefined) dog.issue = fm.issue;

  const sources = readPages(lines, start, warn);
  if (sources.length > PAGE_COUNT) {
    fail('pages', `a zine has exactly ${PAGE_COUNT} pages; this has ${sources.length}`, sources[PAGE_COUNT].line);
  } else if (sources.length < PAGE_COUNT) {
    warn('pages', `${sources.length} of ${PAGE_COUNT} pages written; the rest are blank freeform pages`);
  }

  const ctx = {
    paper: fm.paper, margin_mm: fm.margin_mm, dog, assets, warn, fail,
    pageIds: new Set(), itemIds: new Set(), resolved: new Map(),
  };
  dog.pages = Array.from({ length: PAGE_COUNT }, (_, p) => (sources[p]
    ? compilePage(sources[p], p, ctx)
    : { id: pageId(undefined, p, ctx), layout: 'freeform', bg: 'paper', items: [] }));

  restoreKept(fm.kept, from, ctx);

  const checked = validateDog(dog, { mode: 'strict' });
  if (!checked.ok) errors.push(...checked.errors);
  return { dog, warnings, errors };
}

function readMeta(meta, paperDefault, warn, fail) {
  const value = (key) => meta[key]?.value;
  for (const key of Object.keys(meta)) {
    if (!FRONT_KEYS.includes(key)) warn(key, `unknown front matter key "${key}" is ignored`, meta[key].line);
  }
  if (!Object.hasOwn(meta, 'mustard')) warn('mustard', 'no "mustard: 1" in the front matter; read as Mustard 1');
  else if (value('mustard') !== MUSTARD_VERSION) fail('mustard', `must be ${MUSTARD_VERSION}`, meta.mustard.line);

  let paper = value('paper') ?? paperDefault ?? 'letter';
  if (!PAPER_IDS.includes(paper)) {
    fail('paper', `must be one of ${PAPER_IDS.join(', ')}`, meta.paper?.line);
    paper = 'letter';
  }
  let margin = value('margin_mm') ?? DEFAULT_MARGIN_MM;
  if (typeof margin !== 'number' || margin < 0 || margin > MAX_MARGIN_MM) {
    fail('margin_mm', `must be a number from 0 to ${MAX_MARGIN_MM}`, meta.margin_mm?.line);
    margin = DEFAULT_MARGIN_MM;
  }
  let kept = value('kept') ?? [];
  if (!Array.isArray(kept)) {
    warn('kept', 'must be a list of ids, like [k1, k2]', meta.kept.line);
    kept = [];
  }
  const title = value('title');
  const look = value('look');
  const issue = value('issue');
  return {
    issue: issue ?? undefined,
    paper,
    margin_mm: margin,
    title: title == null ? '' : String(title),
    look: look == null || look === '' ? 'kraft' : String(look),
    kept: kept.map(String),
  };
}

/** Splits the text into `::: page` containers: [{line, attrs, lines: [{text, n}]}]. */
function readPages(lines, start, warn) {
  const pages = [];
  let page = null;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    const n = i + 1;
    const open = /^:::\s*page/.exec(line);
    const after = open ? line.slice(open[0].length) : '';
    if (open && (after === '' || /^\s/.test(after))) {
      if (page) warn(`pages/${pages.length - 1}`, `page is not closed with ::: before line ${n}`, page.line);
      const raw = after.trim();
      const braces = raw.startsWith('{') && raw.endsWith('}');
      let attrs = braces ? parseAttrs(raw.slice(1, -1)) : raw === '' ? emptyAttrs() : null;
      if (!attrs) {
        const shown = raw.slice(0, 80);
        warn(`pages/${pages.length}`, `"${shown}" is not an attribute block like {layout=cover}; ignored`, n);
        attrs = emptyAttrs();
      }
      page = { line: n, attrs, lines: [] };
      pages.push(page);
    } else if (/^:::\s*$/.test(line)) {
      if (page) page = null;
      else warn('', 'a ::: with no open page is ignored', n);
    } else if (page) {
      page.lines.push({ text: line, n });
    } else if (line.trim() !== '') {
      warn('', 'text outside a ::: page is ignored', n);
    }
  }
  if (page) warn(`pages/${pages.length - 1}`, 'page is not closed with :::', page.line);
  return pages;
}

function compilePage(src, p, ctx) {
  const at = `pages/${p}`;
  const { id, classes, kv } = src.attrs;
  let layout = kv.layout;
  if (layout === undefined) {
    ctx.warn(at, 'page has no layout=; it is freeform', src.line);
    layout = 'freeform';
  } else if (!LAYOUT_NAMES.includes(layout)) {
    ctx.fail(`${at}/layout`, `unknown layout "${layout}"; one of ${LAYOUT_NAMES.join(', ')}`, src.line);
    layout = 'freeform';
  }
  for (const k of Object.keys(kv)) {
    if (k !== 'layout' && k !== 'bg') ctx.warn(at, `page attribute ${k}= is ignored`, src.line);
  }
  for (const c of classes) ctx.warn(at, `page class .${c} is ignored`, src.line);
  const page = { id: pageId(id, p, ctx, src.line), layout, bg: kv.bg ?? 'paper', items: [] };

  const blocks = readBlocks(src.lines, (message, line) => ctx.warn(at, message, line));
  const { fills, free } = assignSlots(blocks, layout, at, ctx);
  const slotFills = Object.fromEntries([...fills].map(([name, f]) => [name, { ...f.content, by: 'import' }]));
  const opts = { margin_mm: ctx.margin_mm, page: p + 1 };
  const pairs = place(layout, slotFills, ctx.paper, opts).map((item) => ({ item, block: fills.get(item.slot).block }));
  const area = safeArea(ctx.paper, ctx.margin_mm, p + 1);
  free.forEach((block, k) => pairs.push({ item: freeItem(block, k, free.length, area), block, free: true }));
  // Items keep document order, which is the Dog's z-order.
  const order = new Map(blocks.map((block, i) => [block, i]));
  pairs.sort((a, b) => order.get(a.block) - order.get(b.block));

  pairs.forEach(({ item, block, free: loose }, i) => {
    const path = `${at}/items/${i}`;
    const moved = applyAttrs(item, block, path, area, ctx);
    if (item.type === 'image') item.asset = resolveAsset(block.src, `${path}/asset`, block.line, ctx);
    if (loose && layout !== 'freeform' && !block.attrs.classes.some((c) => c === 'free' || c === 'place')) {
      ctx.warn(path, `no slot left for this ${block.kind} on layout ${layout}; it is placed freely`, block.line);
    }
    if (item.slot && item.type === 'text' && !moved) {
      const text = item.runs.map((r) => r.text).join('\n');
      if (overflows(layout, item.slot, text, ctx.paper, opts)) {
        const max = budget(layout, item.slot, ctx.paper, opts);
        const used = codePoints(text);
        ctx.warn(`${path}/runs`, `over budget: this runs past the ${item.slot} slot of ${layout}, which holds about `
          + `${max} characters on ${ctx.paper}; this has ${used}`, block.line);
      }
    }
  });
  page.items = pairs.map((pair) => pair.item);
  return page;
}

/**
 * Fills the layout's slots in order: first heading → title, `>` → quote, a list → list, images → image slots,
 * paragraphs (and headings or quotes with no slot of their own) → the remaining text slots. A bare paragraph with
 * no slot left continues the last one; anything else with no slot, or marked `.free`, is placed freely.
 */
function assignSlots(blocks, layout, at, ctx) {
  const defs = LAYOUTS[layout].slots;
  const fills = new Map();
  const free = [];
  let lastPara = null;
  const fill = (def, block) => {
    fills.set(def.name, { block, content: contentFor(def, block) });
    if (isPara(def)) lastPara = def;
  };
  const append = (def, block) => {
    const { content } = fills.get(def.name);
    content.text += `\n\n${block.text}`;
    const { id, classes, kv } = block.attrs;
    if (id !== undefined || classes.length || Object.keys(kv).some((k) => k !== 'slot')) {
      ctx.warn(at, `attributes on a paragraph that continues ${def.name} are ignored`, block.line);
    }
  };

  for (const block of blocks) {
    if (block.attrs.classes.includes('free')) {
      free.push(block);
      continue;
    }
    const wanted = block.attrs.kv.slot;
    if (wanted !== undefined) {
      const def = defs.find((d) => d.name === wanted);
      if (!def) {
        ctx.warn(at, `layout ${layout} has no slot "${wanted}"; slot= is ignored`, block.line);
      } else if (!fits(def, block)) {
        ctx.warn(at, `a ${block.kind} cannot fill the ${def.name} slot; it is placed freely`, block.line);
        free.push(block);
        continue;
      } else if (!fills.has(def.name)) {
        fill(def, block);
        continue;
      } else if (def.kind === 'text' && block.kind !== 'image') {
        append(def, block);
        continue;
      } else {
        ctx.warn(at, `the ${def.name} slot is already filled; this ${block.kind} is placed freely`, block.line);
        free.push(block);
        continue;
      }
    }
    const def = routeBlock(block.kind, defs, (name) => fills.has(name));
    if (!def && block.kind !== 'list' && block.kind !== 'image' && lastPara && isBare(block.attrs)) {
      append(lastPara, block);
      continue;
    }
    if (def) fill(def, block);
    else free.push(block);
  }
  return { fills, free };
}

const isBare = ({ id, classes, kv }) => id === undefined && !classes.length && !Object.keys(kv).length;
const fits = (def, block) => (def.kind === 'image') === (block.kind === 'image')
  && !(def.kind === 'text' && block.kind === 'list');

function contentFor(def, block) {
  if (def.kind === 'image') return {};
  if (def.kind === 'list') return { items: block.items ?? block.text.split('\n').filter((s) => s !== '') };
  return { text: block.text };
}

/** A slotless item; its default box is one of n equal rows of the safe area. */
function freeItem(block, k, n, area) {
  const box = { x: area.x, y: area.y + (k * area.h) / n, w: area.w, h: area.h / n };
  if (block.kind === 'image') {
    return { id: `image_${randomId()}`, type: 'image', by: 'import', ...box, fit: 'cover', focus: [0.5, 0.5] };
  }
  const [layout, slot] = FREE_STYLE[block.kind];
  const s = LAYOUTS[layout].slots.find((d) => d.name === slot);
  const runs = block.kind === 'list' ? block.items.map((t) => ({ text: `${BULLET} ${t}` })) : [{ text: block.text }];
  return {
    id: `text_${randomId()}`, type: 'text', by: 'import', ...box,
    font: s.font, size: s.size, align: s.align, color: 'toner', runs,
  };
}

/**
 * Applies a block's attribute block to its item. Returns whether `.place` moved it.
 * Missing w/h on a placed item run to the safe area's far edge (or keep the default size past it).
 */
function applyAttrs(item, block, path, area, ctx) {
  const { id, classes, kv } = block.attrs;
  if (id !== undefined) {
    if (ctx.itemIds.has(id)) ctx.fail(`${path}/id`, `duplicate id "${id}"`, block.line);
    else item.id = id;
  }
  ctx.itemIds.add(item.id);

  const attrs = {};
  if (block.kind === 'image' && block.alt) attrs.alt = block.alt;
  const cls = classes.filter((c) => c !== 'place' && c !== 'free');
  if (cls.length) attrs.class = cls.join(' ');
  const placing = classes.includes('place');
  const given = {};
  for (const [k, v] of Object.entries(kv)) {
    if (k === 'slot') continue;
    if (k === 'by') {
      if (BY_VALUES.includes(v)) item.by = v;
      else ctx.warn(`${path}/by`, `by= must be one of ${BY_VALUES.join(', ')}; "${v}" is ignored`, block.line);
    } else if (k === 'locked') {
      if (v === 'true' || v === 'false') item.locked = v === 'true';
      else ctx.warn(`${path}/locked`, 'locked= must be true or false', block.line);
    } else if (k === 'focus' && item.type === 'image') {
      const f = v.split(',').map(Number);
      if (f.length === 2 && f.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) item.focus = f;
      else ctx.warn(`${path}/focus`, 'focus= must be two numbers from 0 to 1, like focus=0.5,0.35', block.line);
    } else if (GEOMETRY.includes(k)) {
      const n = Number(v);
      if (!placing) {
        ctx.warn(path, `${k}= moves an item only next to .place; it is kept under attrs`, block.line);
        attrs[k] = v;
      } else if (v === '' || !Number.isFinite(n)) {
        ctx.warn(`${path}/${k}`, `${k}= must be a number`, block.line);
      } else {
        given[k] = n;
      }
    } else {
      attrs[k] = v;
    }
  }
  const moved = placing && Object.keys(given).length > 0;
  if (moved) {
    Object.assign(item, given);
    const right = area.x + area.w - item.x;
    const bottom = area.y + area.h - item.y;
    if (given.w === undefined && given.x !== undefined && right > 0) item.w = right;
    if (given.h === undefined && given.y !== undefined && bottom > 0) item.h = bottom;
  }
  if (Object.keys(attrs).length) item.attrs = attrs;
  return moved;
}

/** An asset id for an image name: a known asset (by id, name or file:<id>) or one shared placeholder per name. */
function resolveAsset(src, path, line, ctx) {
  if (!ctx.resolved.has(src)) {
    const { assets, dog } = ctx;
    const fileId = /^file:(\d+)$/.exec(src)?.[1];
    const matches = (k) => !NUMERIC_ID.test(k)
      && (fileId !== undefined ? String(assets[k]?.file_id) === fileId : assets[k]?.name === src);
    let key = Object.hasOwn(assets, src) && !NUMERIC_ID.test(src) ? src : Object.keys(assets).find(matches);
    const known = key !== undefined;
    if (known) {
      dog.assets[key] = structuredClone(assets[key]);
    } else {
      key = randomId();
      dog.assets[key] = { kind: 'placeholder', name: src };
    }
    ctx.resolved.set(src, { key, known });
  }
  const { key, known } = ctx.resolved.get(src);
  if (!known) ctx.warn(path, `unknown image "${src}": a placeholder stands in until the file is uploaded`, line);
  return key;
}

function pageId(id, p, ctx, line) {
  if (id !== undefined) {
    if (!ctx.pageIds.has(id)) {
      ctx.pageIds.add(id);
      return id;
    }
    ctx.fail(`pages/${p}/id`, `duplicate page id "${id}"`, line);
  }
  let fresh = `p${p + 1}`;
  if (ctx.pageIds.has(fresh)) fresh = `${fresh}_${randomId()}`;
  ctx.pageIds.add(fresh);
  return fresh;
}

/** Copies `kept:` items (ink, stickers, shapes) back from the zine being re-imported into, onto the same page. */
function restoreKept(kept, from, ctx) {
  if (!kept.length) return;
  if (!from) {
    ctx.warn('kept', `${kept.length} kept item(s) (ink, stickers, shapes) come back only when re-imported `
      + 'into the same zine');
    return;
  }
  /** id → [page, index] in the zine being re-imported into. */
  const where = new Map();
  (Array.isArray(from.pages) ? from.pages.slice(0, PAGE_COUNT) : []).forEach((pg, p) => {
    (Array.isArray(pg?.items) ? pg.items : []).forEach((item, i) => {
      if (typeof item?.id === 'string' && !where.has(item.id)) where.set(item.id, [p, i]);
    });
  });
  const wanted = kept.filter((id) => {
    if (!where.has(id)) ctx.warn('kept', `kept item "${id}" is not in this zine`);
    else if (ctx.itemIds.has(id)) ctx.warn('kept', `kept item "${id}" shares an id with the text; not restored`);
    else return true;
    return false;
  });
  // In the zine's own order, each goes straight after the nearest earlier item that is on the page, so z-order holds.
  wanted.sort((a, b) => where.get(a)[0] - where.get(b)[0] || where.get(a)[1] - where.get(b)[1]);
  for (const id of wanted) {
    const [p, i] = where.get(id);
    const before = from.pages[p].items;
    const item = structuredClone(before[i]);
    const asset = typeof item.asset === 'string' ? from.assets?.[item.asset] : undefined;
    if (asset && !Object.hasOwn(ctx.dog.assets, item.asset)) ctx.dog.assets[item.asset] = structuredClone(asset);
    const items = ctx.dog.pages[p].items;
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const k = items.findIndex((x) => x.id === before[j]?.id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    items.splice(at, 0, item);
    ctx.itemIds.add(id);
  }
}


// ---------------------------------------------------------------------------------------------------------------
// Blocks

/**
 * A page's lines as blocks: heading, image, quote, list, paragraph. Each block's trailing `{…}` on its last line is
 * its attribute block. A blank `>` line in a quote is a paragraph break; other text rules are in mustard-syntax.js.
 * A line that starts like an image but does not parse is reported through problem() and read as text.
 */
function readBlocks(lines, problem) {
  const blocks = [];
  let cur = null;
  for (const { text, n } of lines) {
    const line = text.trim();
    let m;
    const image = line.startsWith('![') ? splitAttrs(line) : null;
    const parsed = image && parseImage(image.text);
    if (image && !parsed) problem('this line starts like an image ![alt](name) but does not parse; read as text', n);
    if (line === '') {
      cur = null;
    } else if ((m = /^#{1,6}(?:\s+(.*))?$/.exec(line))) {
      blocks.push({ kind: 'heading', lines: [m[1] ?? ''], line: n });
      cur = null;
    } else if (parsed) {
      blocks.push({ kind: 'image', alt: parsed.alt, src: parsed.src, attrs: image.attrs, line: n });
      cur = null;
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      if (cur?.kind !== 'quote') blocks.push((cur = { kind: 'quote', lines: [], line: n }));
      cur.lines.push(m[1]);
    } else if ((m = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      if (cur?.kind !== 'list') blocks.push((cur = { kind: 'list', lines: [], line: n }));
      cur.lines.push(m[1]);
    } else {
      if (cur?.kind !== 'paragraph') blocks.push((cur = { kind: 'paragraph', lines: [], line: n }));
      cur.lines.push(line);
    }
  }
  for (const b of blocks) {
    if (b.kind === 'image') continue;
    const last = splitAttrs(b.lines[b.lines.length - 1]);
    b.lines[b.lines.length - 1] = last.text;
    b.attrs = last.attrs;
    if (b.kind === 'list') b.items = b.lines.map((l) => unescapeLine(l.trim()));
    else if (b.kind === 'quote') b.text = splitOn(b.lines, (l) => l.trim() === '').map(inline).join('\n\n');
    else b.text = inline(b.lines);
  }
  return blocks;
}

function splitOn(list, isBreak) {
  const groups = [[]];
  for (const x of list) {
    if (isBreak(x)) groups.push([]);
    else groups[groups.length - 1].push(x);
  }
  return groups.filter((g) => g.length);
}

/** Characters as code points, the Dog's own measure. */
const codePoints = (s) => { let n = 0; for (const _ of s) n += 1; return n; };
