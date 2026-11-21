// Mustard's inline syntax, both directions: attribute blocks, images, text escapes and how a block finds its slot.
// Compile (mustard.js) and export (mustard-export.js) share it so what one writes the other reads. Pure, no DOM.
// Linear time: scanners or anchored regexes only, nothing that backtracks over a long run.
import { unquote } from './frontmatter.js?v=0.1.0';

/** @typedef {{id?: string, classes: string[], kv: Record<string, string>}} Attrs */

export const MUSTARD_VERSION = 1;
/** Item types Mustard cannot write; export lists their ids under `kept:`. */
export const KEPT_TYPES = Object.freeze(['ink', 'sticker', 'shape']);

/** An id or class an attribute block can carry: no whitespace, braces, #, ., = or quote. */
export const canName = (s) => typeof s === 'string' && /^[^\s{}#.="]+$/.test(s);
export const KEY = /^[A-Za-z_][\w-]*$/;

export const emptyAttrs = () => ({ id: undefined, classes: [], kv: {} });

const ATTR = /(?:#([^\s{}#.="]+)|\.([^\s{}#.="]+)|([A-Za-z_][\w-]*)=("(?:[^"\\]|\\.)*"|[^\s{}"]*))/y;

/**
 * Pandoc attributes: `#id .class key=value key="quoted value"`. Null when anything else is in there.
 * @param {string} inner the text between the braces
 * @returns {Attrs|null}
 */
export function parseAttrs(inner) {
  const out = emptyAttrs();
  let pos = 0;
  for (;;) {
    while (pos < inner.length && /\s/.test(inner[pos])) pos += 1;
    if (pos === inner.length) return out;
    ATTR.lastIndex = pos;
    const m = ATTR.exec(inner);
    if (!m) return null;
    pos = ATTR.lastIndex;
    if (m[1] !== undefined) out.id = m[1];
    else if (m[2] !== undefined) out.classes.push(m[2]);
    else out.kv[m[3]] = m[4].startsWith('"') ? unquote(m[4].slice(1, -1)) : m[4];
  }
}

/** A trailing `{…}` that parses as attributes is split off; anything else stays text. */
export function splitAttrs(s) {
  const t = s.trimEnd();
  if (t.endsWith('}')) {
    const open = t.lastIndexOf('{');
    const attrs = open >= 0 ? parseAttrs(t.slice(open + 1, -1)) : null;
    if (attrs) return { text: t.slice(0, open).trimEnd(), attrs };
  }
  return { text: s, attrs: emptyAttrs() };
}

/** A value parseAttrs reads back exactly: plain when it can be, else quoted with braces escaped. */
export function attrValue(v) {
  if (/^[^\s{}"]+$/.test(v)) return v;
  return JSON.stringify(v).replace(/[{}]/g, (c) => (c === '{' ? '\\u007b' : '\\u007d'));
}

const PUNCT = /[!-/:-@[-`{-~]/;

/**
 * `![alt](dest)` with backslash escapes in alt, and a dest that is `<…>` (CommonMark, escapes allowed) or raw with
 * balanced parentheses. Returns {alt, src} or null.
 */
export function parseImage(s) {
  if (!s.startsWith('![')) return null;
  let i = 2;
  let alt = '';
  for (; i < s.length && s[i] !== ']'; i += 1) {
    if (s[i] === '\\' && PUNCT.test(s[i + 1] ?? '')) i += 1;
    alt += s[i];
  }
  if (s[i] !== ']' || s[i + 1] !== '(') return null;
  i += 2;
  let src = '';
  if (s[i] === '<') {
    for (i += 1; i < s.length && s[i] !== '>'; i += 1) {
      if (s[i] === '\\' && PUNCT.test(s[i + 1] ?? '')) i += 1;
      src += s[i];
    }
    if (s[i] !== '>') return null;
    i += 1;
  } else {
    let depth = 0;
    for (; i < s.length; i += 1) {
      const c = s[i];
      if (c === '\\' && PUNCT.test(s[i + 1] ?? '')) {
        i += 1;
        src += s[i];
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')' && depth === 0) break;
      else if (c === ')') depth -= 1;
      src += c;
    }
  }
  if (s[i] !== ')' || s.slice(i + 1).trim() !== '') return null;
  return { alt, src: src.trim() };
}

/** The image line parseImage reads back: alt brackets escaped, dest in `<…>` when it needs it. */
export function formatImage(alt, name) {
  const a = alt.replace(/[\\[\]]/g, '\\$&');
  const plain = name !== '' && !/[\s()<>\\]/.test(name);
  return `![${a}](${plain ? name : `<${name.replace(/[\\<>]/g, '\\$&').replace(/\n/g, ' ')}>`})`;
}

/** A leading `\` before a block marker is dropped. */
export const unescapeLine = (s) => s.replace(/^\\(?=[#>\-*+!:\\\d])/, '');

/** Block text from lines: soft breaks join with a space, a trailing `\` is a hard break. */
export function inline(lines) {
  let out = '';
  lines.forEach((raw, i) => {
    let s = unescapeLine(raw.trim());
    const hard = i < lines.length - 1 && s.endsWith('\\');
    if (hard) s = s.slice(0, -1).trimEnd();
    out += s + (i < lines.length - 1 ? (hard ? '\n' : ' ') : '');
  });
  return out;
}

/** Text as markdown lines inline() reads back: each newline a hard break, block markers escaped. */
export function markdownLines(text) {
  const lines = text.split('\n');
  return lines.map((l, i) => {
    const s = l.trim();
    const escaped = /^(#{1,6}(\s|$)|>|[-*+]\s|\d+[.)]\s|!\[|:::|\\)/.test(s) ? `\\${s}` : s;
    return i < lines.length - 1 ? `${escaped}\\` : escaped;
  });
}

/** Text slots that take paragraphs (title and quote have their own block kinds). */
export const isPara = (d) => d.kind === 'text' && d.name !== 'title' && d.name !== 'quote';

/**
 * The slot a block of this kind takes when it names none: heading → title, `>` → quote, list → list,
 * image → the first open image slot; paragraphs, and headings or quotes without their own slot, → the first
 * open text slot.
 * @param {'heading'|'quote'|'list'|'image'|'paragraph'} kind
 * @param {{name: string, kind: string}[]} defs the layout's slots in order
 * @param {(name: string) => boolean} filled
 */
export function routeBlock(kind, defs, filled) {
  const open = (pred) => defs.find((d) => pred(d) && !filled(d.name));
  let def;
  if (kind === 'heading') def = open((d) => d.name === 'title');
  else if (kind === 'quote') def = open((d) => d.name === 'quote');
  else if (kind === 'list') def = open((d) => d.kind === 'list');
  else if (kind === 'image') def = open((d) => d.kind === 'image');
  if (!def && kind !== 'list' && kind !== 'image') def = open(isPara);
  return def;
}
