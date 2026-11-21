// A text item's runs as one editable text and back. Runs are spans of one paragraph, except in a list item, where
// each run is one bullet line. The renderer and the in-place text editor both read them through here. Pure, no DOM.
import { BULLET } from './layouts.js';

const texts = (item) => (Array.isArray(item?.runs) ? item.runs : []).map((r) => (typeof r?.text === 'string' ? r.text : ''));

/**
 * A list item: the `list` slot, or runs that all start with the bullet.
 * @param {any} item
 */
export function isListItem(item) {
  const t = texts(item);
  return item?.slot === 'list' || (t.length > 0 && t.every((s) => s.startsWith(BULLET)));
}

/**
 * The item's text: list runs one per line, other runs joined as spans.
 * @param {any} item
 * @returns {string}
 */
export function joinRuns(item) {
  const t = texts(item);
  if (!isListItem(item)) return t.join('');
  return t.reduce((acc, s, i) => (i > 0 && !acc.endsWith('\n') ? `${acc}\n${s}` : acc + s), '');
}

/**
 * Typed text back to runs: one run per non-blank line for a list item (or when every line is a bullet line),
 * else one run.
 * @param {any} item
 * @param {string} text
 * @returns {{text: string}[]}
 */
export function splitRuns(item, text) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const bullets = lines.length > 0 && lines.every((l) => l.startsWith(BULLET));
  if ((isListItem(item) || bullets) && lines.length > 0) return lines.map((l) => ({ text: l }));
  return [{ text }];
}
