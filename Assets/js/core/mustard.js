// Mustard (*.mustard.md): markdown for writing a zine. compileMustard turns it into the Dog (deterministic apart from
// minted ids); exportMustard writes a Dog back as Mustard. Pure, no DOM. Format: hotdogpress-formats.md.
import { newDog, validateDog, randomId, LAYOUT_NAMES, BY_VALUES, PAPER_IDS } from './dog.js';
import { LAYOUTS, place, budget, BULLET } from './layouts.js';
import { safeArea } from './impose.js';
import { DEFAULT_MARGIN_MM, MAX_MARGIN_MM } from './paper.js';

/** @typedef {{path: string, message: string, line?: number}} MustardProblem */
/** @typedef {{id?: string, classes: string[], kv: Record<string, string>}} Attrs */

export const MUSTARD_VERSION = 1;
const PAGE_COUNT = 8;
const FRONT_KEYS = ['mustard', 'title', 'issue', 'paper', 'look', 'margin_mm', 'kept'];
/** Item types Mustard cannot write; export lists their ids under `kept:`. */
const KEPT_TYPES = ['ink', 'sticker', 'shape'];
const BOX = ['x', 'y', 'w', 'h'];
/** Keys that move an item; they act only next to `.place`. */
const GEOMETRY = [...BOX, 'rot'];
/** A block with no slot borrows the style of the slot its kind normally fills: [layout, slot]. */
const FREE_STYLE = {
  heading: ['headline-body', 'title'],
  paragraph: ['headline-body', 'body'],
  quote: ['quote', 'quote'],
  list: ['list', 'list'],
};
const EPS = 1e-6;
const KEY = /^[A-Za-z_][\w-]*$/;
const NUMERIC_ID = /^[0-9]+$/;
const KEPT_NOTE = '# Exported from Hot Dog Press. Ink, stickers and shapes are listed in kept: and come back only '
  + 'when this is re-imported into the same zine.';

// ---------------------------------------------------------------------------------------------------------------
// Compile

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

  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
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
    const open = /^:::\s*page(?:\s+(.*?))?\s*$/.exec(line);
    if (open) {
      if (page) warn(`pages/${pages.length - 1}`, `page is not closed with ::: before line ${n}`, page.line);
      const raw = open[1] ?? '';
      const braces = /^\{(.*)\}$/.exec(raw);
      let attrs = braces ? parseAttrs(braces[1]) : raw === '' ? emptyAttrs() : null;
      if (!attrs) {
        warn(`pages/${pages.length}`, `"${raw}" is not an attribute block like {layout=cover}; ignored`, n);
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

  const { fills, free } = assignSlots(readBlocks(src.lines), layout, at, ctx);
  const slotFills = Object.fromEntries([...fills].map(([name, f]) => [name, { ...f.content, by: 'import' }]));
  const opts = { margin_mm: ctx.margin_mm, page: p + 1 };
  const pairs = place(layout, slotFills, ctx.paper, opts).map((item) => ({ item, block: fills.get(item.slot).block }));
  const area = safeArea(ctx.paper, ctx.margin_mm, p + 1);
  free.forEach((block, k) => pairs.push({ item: freeItem(block, k, free.length, area), block, free: true }));

  pairs.forEach(({ item, block, free: loose }, i) => {
    const path = `${at}/items/${i}`;
    const moved = applyAttrs(item, block, path, area, ctx);
    if (item.type === 'image') item.asset = resolveAsset(block.src, `${path}/asset`, block.line, ctx);
    if (loose && layout !== 'freeform' && !block.attrs.classes.some((c) => c === 'free' || c === 'place')) {
      ctx.warn(path, `no slot left for this ${block.kind} on layout ${layout}; it is placed freely`, block.line);
    }
    if (item.slot && item.type === 'text' && !moved) {
      const max = budget(layout, item.slot, ctx.paper, opts);
      const used = codePoints(item.runs.map((r) => r.text).join('\n'));
      if (used > max) {
        ctx.warn(`${path}/runs`, `over budget: the ${item.slot} slot of ${layout} holds about ${max} characters `
          + `on ${ctx.paper}; this has ${used}`, block.line);
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
  const open = (pred) => defs.find((d) => pred(d) && !fills.has(d.name));
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
    let def;
    if (block.kind === 'heading') def = open((d) => d.name === 'title');
    else if (block.kind === 'quote') def = open((d) => d.name === 'quote');
    else if (block.kind === 'list') def = open((d) => d.kind === 'list');
    else if (block.kind === 'image') def = open((d) => d.kind === 'image');
    if (!def && block.kind !== 'list' && block.kind !== 'image') {
      def = open(isPara);
      if (!def && lastPara && isBare(block.attrs)) {
        append(lastPara, block);
        continue;
      }
    }
    if (def) fill(def, block);
    else free.push(block);
  }
  return { fills, free };
}

const isPara = (d) => d.kind === 'text' && d.name !== 'title' && d.name !== 'quote';
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
  const pages = Array.isArray(from.pages) ? from.pages.slice(0, PAGE_COUNT) : [];
  for (const id of kept) {
    const p = pages.findIndex((pg) => Array.isArray(pg?.items) && pg.items.some((i) => i?.id === id));
    if (p < 0) {
      ctx.warn('kept', `kept item "${id}" is not in this zine`);
    } else if (ctx.itemIds.has(id)) {
      ctx.warn('kept', `kept item "${id}" has the same id as an item in the text; it is not restored`);
    } else {
      const item = structuredClone(pages[p].items.find((i) => i?.id === id));
      const asset = typeof item.asset === 'string' ? from.assets?.[item.asset] : undefined;
      if (asset && !Object.hasOwn(ctx.dog.assets, item.asset)) ctx.dog.assets[item.asset] = structuredClone(asset);
      ctx.dog.pages[p].items.push(item);
      ctx.itemIds.add(id);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Blocks and attributes

/**
 * A page's lines as blocks: heading, image, quote, list, paragraph. Each block's trailing `{…}` on its last line is
 * its attribute block. Block text: soft line breaks join with a space, a trailing `\` is a hard break, a blank `>`
 * line in a quote is a paragraph break, and a leading `\` escapes a block marker.
 */
function readBlocks(lines) {
  const blocks = [];
  let cur = null;
  for (const { text, n } of lines) {
    const line = text.trim();
    let m;
    if (line === '') {
      cur = null;
    } else if ((m = /^#{1,6}(?:\s+(.*))?$/.exec(line))) {
      blocks.push({ kind: 'heading', lines: [m[1] ?? ''], line: n });
      cur = null;
    } else if (isImage(line)) {
      const { text: body, attrs } = splitAttrs(line);
      m = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(body);
      blocks.push({ kind: 'image', alt: m[1], src: m[2].trim(), attrs, line: n });
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
    if (b.kind === 'list') b.items = b.lines.map((l) => unescape(l.trim()));
    else if (b.kind === 'quote') b.text = splitOn(b.lines, (l) => l.trim() === '').map(inline).join('\n\n');
    else b.text = inline(b.lines);
  }
  return blocks;
}

const isImage = (line) => /^!\[([^\]]*)\]\(([^)]*)\)$/.test(splitAttrs(line).text);
const unescape = (s) => s.replace(/^\\(?=[#>\-*+!:\\\d])/, '');

function inline(lines) {
  let out = '';
  lines.forEach((raw, i) => {
    let s = unescape(raw.trim());
    const hard = i < lines.length - 1 && s.endsWith('\\');
    if (hard) s = s.slice(0, -1).trimEnd();
    out += s + (i < lines.length - 1 ? (hard ? '\n' : ' ') : '');
  });
  return out;
}

function splitOn(list, isBreak) {
  const groups = [[]];
  for (const x of list) {
    if (isBreak(x)) groups.push([]);
    else groups[groups.length - 1].push(x);
  }
  return groups.filter((g) => g.length);
}

const emptyAttrs = () => ({ id: undefined, classes: [], kv: {} });

/** A trailing `{…}` that parses as attributes is split off; anything else stays text. */
function splitAttrs(s) {
  const m = /\{([^{}]*)\}\s*$/.exec(s);
  const attrs = m ? parseAttrs(m[1]) : null;
  return attrs ? { text: s.slice(0, m.index).trimEnd(), attrs } : { text: s, attrs: emptyAttrs() };
}

const ATTR = /\s*(?:#([^\s{}#.="]+)|\.([^\s{}#.="]+)|([A-Za-z_][\w-]*)=("(?:[^"\\]|\\.)*"|[^\s{}"]*))/y;

/**
 * Pandoc attributes: `#id .class key=value key="quoted value"`. Null when anything else is in there.
 * @returns {Attrs|null}
 */
function parseAttrs(inner) {
  const out = emptyAttrs();
  let pos = 0;
  while (!/^\s*$/.test(inner.slice(pos))) {
    ATTR.lastIndex = pos;
    const m = ATTR.exec(inner);
    if (!m) return null;
    pos = ATTR.lastIndex;
    if (m[1] !== undefined) out.id = m[1];
    else if (m[2] !== undefined) out.classes.push(m[2]);
    else out.kv[m[3]] = m[4].startsWith('"') ? unquote(m[4].slice(1, -1)) : m[4];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Front matter: a YAML subset of `key: value` lines with plain scalars, quoted strings, flow lists and comments.

function readFrontMatter(lines, warn) {
  const meta = {};
  if (lines[0]?.trim() !== '---') return { meta, start: 0 };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) {
    warn('', 'the front matter is not closed with ---', 1);
    return { meta, start: 0 };
  }
  for (let i = 1; i < end; i += 1) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/.exec(line);
    const value = m ? yamlValue(m[2] ?? '') : undefined;
    if (value === undefined) warn('', `front matter line is not "key: value": ${line}`, i + 1);
    else meta[m[1]] = { value, line: i + 1 };
  }
  return { meta, start: end + 1 };
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
const unquote = (s) => s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => (c.length === 5
  ? String.fromCharCode(parseInt(c.slice(1), 16))
  : ESCAPES[c] ?? c));
const commentOrEmpty = (s) => /^\s*(#.*)?$/.test(s);

/** A YAML value, or undefined when it is not one this subset reads. */
function yamlValue(raw) {
  const s = raw.trim();
  if (s.startsWith('[')) return yamlList(s.slice(1).trim());
  const q = quoted(s);
  if (q) return commentOrEmpty(q.rest) ? q.value : undefined;
  return plainScalar(s.replace(/(^|\s+)#.*$/, '').trim());
}

function quoted(s) {
  let m = /^"((?:[^"\\]|\\.)*)"/.exec(s);
  if (m) return { value: unquote(m[1]), rest: s.slice(m[0].length) };
  m = /^'((?:[^']|'')*)'/.exec(s);
  if (m) return { value: m[1].replaceAll("''", "'"), rest: s.slice(m[0].length) };
  return null;
}

function plainScalar(s) {
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === '' || s === 'null' || s === '~') return null;
  return s;
}

function yamlList(rest) {
  const out = [];
  if (rest.startsWith(']')) return commentOrEmpty(rest.slice(1)) ? out : undefined;
  for (;;) {
    const q = quoted(rest);
    if (q) {
      out.push(q.value);
      rest = q.rest.trim();
    } else {
      const m = /^[^,\]]*/.exec(rest);
      out.push(plainScalar(m[0].trim()));
      rest = rest.slice(m[0].length);
    }
    if (rest.startsWith(',')) rest = rest.slice(1).trim();
    else if (rest.startsWith(']')) return commentOrEmpty(rest.slice(1)) ? out : undefined;
    else return undefined;
  }
}

/** A scalar written plain when it reads back as the same string, double-quoted otherwise. */
function yamlScalar(v) {
  if (typeof v === 'number') return String(v);
  const s = String(v);
  const plain = s !== '' && s === s.trim() && plainScalar(s) === s && !/[:#"'[\]{},&*!|>%@`\\]|^[-?]/.test(s);
  return plain ? s : JSON.stringify(s);
}

// ---------------------------------------------------------------------------------------------------------------
// Export

/**
 * A Dog as Mustard. Slot items become markdown, moved items get `{.place}`, every item gets `{#id}`; ink, stickers
 * and shapes cannot be written and are listed (page order) in `kept`. Text styles, crops and rich runs are not kept.
 * @param {object} dog
 * @returns {{text: string, kept: string[]}}
 */
export function exportMustard(dog) {
  const kept = [];
  const pages = (dog.pages ?? []).map((page, p) => exportPage(page, p, dog, kept));
  const front = ['---'];
  if (kept.length) front.push(KEPT_NOTE);
  front.push(`mustard: ${MUSTARD_VERSION}`, `title: ${yamlScalar(dog.title ?? '')}`);
  if (dog.issue !== undefined) front.push(`issue: ${yamlScalar(dog.issue)}`);
  front.push(`paper: ${yamlScalar(dog.paper)}`);
  if (dog.margin_mm !== DEFAULT_MARGIN_MM) front.push(`margin_mm: ${dog.margin_mm}`);
  front.push(`look: ${yamlScalar(dog.look ?? 'kraft')}`);
  if (kept.length) front.push(`kept: [${kept.map(yamlScalar).join(', ')}]`);
  front.push('---');
  return { text: `${[front.join('\n'), ...pages].join('\n\n')}\n`, kept };
}

function exportPage(page, p, dog, kept) {
  const layout = LAYOUT_NAMES.includes(page.layout) ? page.layout : 'freeform';
  const defs = LAYOUTS[layout].slots;
  const bySlot = new Map();
  const free = [];
  for (const item of page.items ?? []) {
    if (KEPT_TYPES.includes(item.type)) {
      kept.push(item.id);
      continue;
    }
    const def = defs.find((d) => d.name === item.slot);
    if (def && !bySlot.has(def.name) && (def.kind === 'image') === (item.type === 'image')) bySlot.set(def.name, item);
    else free.push(item);
  }
  const ctx = { dog, layout, paper: dog.paper, opts: { margin_mm: dog.margin_mm ?? DEFAULT_MARGIN_MM, page: p + 1 } };
  const blocks = [];
  defs.forEach((def, i) => {
    const item = bySlot.get(def.name);
    if (!item) return;
    // Compile fills a kind's slots in layout order, so an empty earlier slot of the same kind needs slot=.
    const pinned = defs.slice(0, i).some((d) => slotClass(d) === slotClass(def) && !bySlot.has(d.name));
    blocks.push(slotBlock(item, def, pinned, ctx));
  });
  for (const item of free) blocks.push(freeBlock(item, layout !== 'freeform', ctx));

  const head = [
    page.id !== `p${p + 1}` ? `#${page.id}` : null,
    `layout=${layout}`,
    page.bg && page.bg !== 'paper' ? `bg=${attrValue(String(page.bg))}` : null,
  ].filter(Boolean).join(' ');
  return [`::: page {${head}}`, ...(blocks.length ? [blocks.join('\n\n')] : []), ':::'].join('\n');
}

function slotClass(def) {
  if (def.kind !== 'text') return def.kind;
  return def.name === 'title' || def.name === 'quote' ? def.name : 'para';
}

function slotBlock(item, def, pinned, ctx) {
  const attrs = (slot) => itemAttrs(item, { slot: slot ? def.name : null, place: moved(item, def, ctx) });
  if (def.kind === 'image') return imageBlock(item, ctx.dog, attrs(pinned));
  if (def.kind === 'list') {
    return item.runs?.length ? listBlock(item.runs, attrs(pinned)) : paragraphBlock('', attrs(true));
  }
  const text = runsText(item.runs);
  if (def.name === 'title') {
    return text.includes('\n') ? paragraphBlock(text, attrs(true)) : `# ${text} ${attrs(false)}`;
  }
  if (def.name === 'quote') return quoteBlock(text, attrs(false));
  return paragraphBlock(text, attrs(pinned));
}

function freeBlock(item, markFree, ctx) {
  const attrs = itemAttrs(item, { free: markFree, place: true });
  if (item.type === 'image') return imageBlock(item, ctx.dog, attrs);
  const runs = item.runs ?? [];
  if (runs.length && runs.every((r) => r.text.startsWith(BULLET))) return listBlock(runs, attrs);
  const text = runsText(runs);
  if (item.font === 'display' && item.align === 'center') return quoteBlock(text, attrs);
  if (item.font === 'display' && !text.includes('\n')) return `# ${text} ${attrs}`;
  return paragraphBlock(text, attrs);
}

/** Whether an item sits anywhere but where its slot would put it on this page. */
function moved(item, def, ctx) {
  const dummy = def.kind === 'image' ? { asset: 'x' } : def.kind === 'list' ? { items: [] } : { text: '' };
  const [home] = place(ctx.layout, { [def.name]: dummy }, ctx.paper, ctx.opts);
  return BOX.some((k) => !(Math.abs(item[k] - home[k]) < EPS));
}

function itemAttrs(item, { slot = null, place: placed = false, free = false }) {
  const parts = [`#${item.id}`];
  if (free) parts.push('.free');
  const geo = placed || (typeof item.rot === 'number' && item.rot !== 0);
  if (geo) parts.push('.place');
  const cls = item.attrs?.class;
  if (typeof cls === 'string' && cls.trim()) parts.push(...cls.trim().split(/\s+/).map((c) => `.${c}`));
  for (const [k, v] of Object.entries(item.attrs ?? {})) {
    if (k === 'class' || (k === 'alt' && item.type === 'image') || !KEY.test(k)) continue;
    parts.push(`${k}=${attrValue(String(v))}`);
  }
  if (geo) {
    parts.push(...BOX.map((k) => `${k}=${num(item[k])}`));
    if (typeof item.rot === 'number' && item.rot !== 0) parts.push(`rot=${num(item.rot)}`);
  }
  if (slot) parts.push(`slot=${slot}`);
  if (item.by && item.by !== 'import') parts.push(`by=${item.by}`);
  if (item.locked === true) parts.push('locked=true');
  if (item.type === 'image' && Array.isArray(item.focus) && (item.focus[0] !== 0.5 || item.focus[1] !== 0.5)) {
    parts.push(`focus=${item.focus.map(num).join(',')}`);
  }
  return `{${parts.join(' ')}}`;
}

function imageBlock(item, dog, attrs) {
  const asset = dog.assets?.[item.asset];
  let name = item.asset ?? '';
  if (typeof asset?.name === 'string' && asset.name !== '') name = asset.name;
  else if (asset?.file_id != null) name = `file:${asset.file_id}`;
  const alt = typeof item.attrs?.alt === 'string' ? item.attrs.alt : '';
  return `![${alt}](${name})${attrs}`;
}

function listBlock(runs, attrs) {
  const lines = runs.map((r) => `- ${r.text.replace(new RegExp(`^${BULLET}\\s?`), '').replace(/\s*\n\s*/g, ' ')}`);
  lines[lines.length - 1] += ` ${attrs}`;
  return lines.join('\n');
}

function quoteBlock(text, attrs) {
  return withAttrs(textLines(text), attrs).map((l) => `> ${l}`).join('\n');
}

function paragraphBlock(text, attrs) {
  return withAttrs(textLines(text), attrs).join('\n');
}

function withAttrs(lines, attrs) {
  const out = [...lines];
  out[out.length - 1] = out[out.length - 1] === '' ? attrs : `${out[out.length - 1]} ${attrs}`;
  return out;
}

/** Text as markdown lines: each newline a hard break (trailing `\`), block markers escaped. */
function textLines(text) {
  const lines = text.split('\n');
  return lines.map((l, i) => {
    const s = l.trim();
    const escaped = /^(#{1,6}(\s|$)|>|[-*+]\s|\d+[.)]\s|!\[|:::|\\)/.test(s) ? `\\${s}` : s;
    return i < lines.length - 1 ? `${escaped}\\` : escaped;
  });
}

const runsText = (runs) => (runs ?? []).map((r) => r.text).join('');
const attrValue = (v) => (/^[^\s{}"]+$/.test(v) ? v : JSON.stringify(v));
/** Six decimals: well inside the 1e-6 a round trip keeps; tiny non-zero values keep full precision. */
function num(n) {
  const r = Number(n.toFixed(6));
  return String(r !== 0 || n === 0 ? r : n);
}
/** Characters as code points, the Dog's own measure. */
const codePoints = (s) => { let n = 0; for (const _ of s) n += 1; return n; };
