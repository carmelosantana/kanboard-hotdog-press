// Mustard front matter: a YAML subset of `key: value` lines with plain scalars, quoted strings, flow lists and
// comments. Pure, no DOM. Linear time: no regex here can backtrack over a long run.

/**
 * Reads `---` … `---` at the top of the lines. meta maps each key to {value, line}; start is the first body line.
 * @param {string[]} lines
 * @param {(path: string, message: string, line?: number) => void} warn
 */
export function readFrontMatter(lines, warn) {
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
    const key = /^[A-Za-z_][\w-]*/.exec(line)?.[0];
    const rest = key === undefined ? '' : line.slice(key.length).trimStart();
    const value = rest.startsWith(':') && (rest.length === 1 || /\s/.test(rest[1]))
      ? yamlValue(rest.slice(1))
      : undefined;
    if (value === undefined) warn('', `front matter line is not "key: value": ${line.slice(0, 80)}`, i + 1);
    else meta[key] = { value, line: i + 1 };
  }
  return { meta, start: end + 1 };
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
/** JSON-style escapes inside double quotes: \n \t \" \\ \uXXXX and friends. */
export const unquote = (s) => s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => (c.length === 5
  ? String.fromCharCode(parseInt(c.slice(1), 16))
  : ESCAPES[c] ?? c));

/** The text before the first `#` that starts a comment (at the start or after whitespace). */
function stripComment(s) {
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}
const commentOrEmpty = (s) => stripComment(s).trim() === '';

/** A YAML value, or undefined when it is not one this subset reads. */
function yamlValue(raw) {
  const s = raw.trim();
  if (s.startsWith('[')) return yamlList(s);
  const q = quotedAt(s, 0);
  if (q) return commentOrEmpty(s.slice(q.end)) ? q.value : undefined;
  return plainScalar(stripComment(s).trim());
}

const DQ = /"((?:[^"\\]|\\.)*)"/y;
const SQ = /'((?:[^']|'')*)'/y;

/** A quoted string starting at index i: {value, end} or null. */
function quotedAt(s, i) {
  DQ.lastIndex = i;
  let m = DQ.exec(s);
  if (m) return { value: unquote(m[1]), end: DQ.lastIndex };
  SQ.lastIndex = i;
  m = SQ.exec(s);
  if (m) return { value: m[1].replaceAll("''", "'"), end: SQ.lastIndex };
  return null;
}

function plainScalar(s) {
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === '' || s === 'null' || s === '~') return null;
  return s;
}

/** `[a, "b", 'c']` scanned by index. */
function yamlList(s) {
  const out = [];
  const skip = (i) => { while (i < s.length && /\s/.test(s[i])) i += 1; return i; };
  let i = skip(1);
  if (s[i] === ']') return commentOrEmpty(s.slice(i + 1)) ? out : undefined;
  for (;;) {
    i = skip(i);
    const q = quotedAt(s, i);
    if (q) {
      out.push(q.value);
      i = skip(q.end);
    } else {
      let j = i;
      while (j < s.length && s[j] !== ',' && s[j] !== ']') j += 1;
      out.push(plainScalar(s.slice(i, j).trim()));
      i = j;
    }
    if (s[i] === ',') i += 1;
    else if (s[i] === ']') return commentOrEmpty(s.slice(i + 1)) ? out : undefined;
    else return undefined;
  }
}

/** A scalar written plain when it reads back as the same string, double-quoted otherwise. */
export function yamlScalar(v) {
  if (typeof v === 'number') return String(v);
  const s = String(v);
  const plain = s !== '' && s === s.trim() && plainScalar(s) === s && !/[:#"'[\]{},&*!|>%@`\\]|^[-?]/.test(s);
  return plain ? s : JSON.stringify(s);
}
