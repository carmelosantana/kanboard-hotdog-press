// Privacy: the plugin names no other origin. Every shipped text file is scanned for http:// and https:// outside
// comments, by each file type's own comment syntax. Allowed: the top-level LICENSE, README and PROVENANCE, the font
// licences Assets/fonts/*/OFL.txt (ruling: licence texts hold URLs), the plugin.json homepage (also
// returned by Plugin::getPluginHomepage), and the SVG/XLink namespace names, which are identifiers, never fetched.
// Test/ is not shipped (the E2E points at the localhost dev stack on purpose).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const HOMEPAGE = JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8')).homepage;
const SKIP_DIRS = new Set(['.git', 'Test', 'node_modules']);
const SKIP_FILES = new Set(['LICENSE', 'README.md', 'PROVENANCE.md']);
const BINARY = /\.(ttf|otf|woff2?|png|jpe?g|webp|gif|ico|zip|pdf)$/i;
const NAMESPACES = ['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink'];
const URL_RE = /https?:\/\/[^\s'"`<>)]+/g;

/**
 * Comment syntax per file type: `line` openers run to the end of the line, `block` pairs may span lines. Template
 * files are HTML with short echo tags, so only HTML comments count there. Anything else (JSON, TXT) has none.
 * @param {string} path relative to the plugin
 */
function syntaxOf(path) {
  const ext = extname(path).slice(1).toLowerCase();
  if (ext === 'php' && path.startsWith('Template/')) return { line: [], block: [['<!--', '-->']] };
  if (ext === 'php') return { line: ['//', '#'], block: [['/*', '*/']] };
  if (ext === 'js' || ext === 'mjs') return { line: ['//'], block: [['/*', '*/']] };
  if (ext === 'css') return { line: [], block: [['/*', '*/']] };
  if (ext === 'svg' || ext === 'html' || ext === 'xml') return { line: [], block: [['<!--', '-->']] };
  return { line: [], block: [] };
}

/**
 * The text with its comments removed. Quoted strings ('…', "…", `…`) are kept whole, so a `//` inside one is no
 * comment. PHP's `#[` starts an attribute, not a comment. In HTML-like files quotes are not tracked (prose may hold
 * apostrophes). A JS regex literal holding a quote could confuse the string tracking; that only ever keeps more text
 * (a false alarm), except for a quote-holding regex followed on its line by a string with `//`: none in the plugin.
 */
function stripComments(path, text) {
  const { line, block } = syntaxOf(path);
  const quotes = line.length ? ['"', "'", '`'] : [];
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
      if (c === quote || (c === '\n' && quote !== '`')) quote = null;
      i++;
      continue;
    }
    const pair = block.find(([open]) => text.startsWith(open, i));
    if (pair) {
      const end = text.indexOf(pair[1], i + pair[0].length);
      i = end < 0 ? text.length : end + pair[1].length;
      continue;
    }
    if (line.some((open) => text.startsWith(open, i) && !(open === '#' && text[i + 1] === '['))) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (quotes.includes(c)) quote = c;
    out += c;
    i++;
  }
  return out;
}

/**
 * The URLs left in a file once its comments are gone, other than the homepage and the XML namespace names.
 * @param {string} path relative to the plugin (it picks the comment syntax)
 * @param {string} text
 * @returns {string[]}
 */
function urlFindings(path, text) {
  return [...stripComments(path, text).matchAll(URL_RE)].map((m) => m[0])
    .filter((url) => url !== HOMEPAGE && !NAMESPACES.includes(url));
}

/** Excluded by path in the plugin: Test/, .git/, node_modules/ at the top, the top-level docs, the font licences. */
const skipped = (rel) => SKIP_DIRS.has(rel.split('/')[0]) || SKIP_FILES.has(rel) || /^Assets\/fonts\/[^/]+\/OFL\.txt$/.test(rel);

function* shipped(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (skipped(relative(ROOT, path))) continue;
    if (entry.isDirectory()) yield* shipped(path);
    else if (!BINARY.test(path)) yield path;
  }
}

test('urlFindings flags URLs in code and strings, not in comments, namespaces or the homepage', () => {
  assert.deepEqual(urlFindings('a.js', "fetch('https://cdn.example.com/x.js');"), ['https://cdn.example.com/x.js']);
  assert.deepEqual(urlFindings('a.svg', '<link href="http://fonts.example.com/a.css">'), ['http://fonts.example.com/a.css']);
  assert.deepEqual(urlFindings('a.css', '@import url(https://e.example/f.css);'), ['https://e.example/f.css']);
  assert.deepEqual(urlFindings('a.js', 'const a = 1; // see https://example.com'), []);
  assert.deepEqual(urlFindings('a.js', '/**\n * @see https://example.com\n */\n/* https://example.com */'), []);
  assert.deepEqual(urlFindings('a.php', '# https://example.com\n// https://example.com'), []);
  assert.deepEqual(urlFindings('a.svg', '<!-- https://example.com -->'), []);
  assert.deepEqual(urlFindings('a.svg', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'), []);
  assert.deepEqual(urlFindings('a.php', `return '${HOMEPAGE}';`), []);
  assert.deepEqual(urlFindings('a.php', `return '${HOMEPAGE}/evil';`), [`${HOMEPAGE}/evil`]);
});

test('urlFindings uses only the comment syntax of the file type, and // inside a string is no comment', () => {
  // CSS has no # or * line comments: these are selectors.
  assert.deepEqual(urlFindings('a.css', '#hotdogpress-app { background: url(https://x.example/a.png) }'), ['https://x.example/a.png']);
  assert.deepEqual(urlFindings('a.css', '* { background: url(https://y.example/b.png) }'), ['https://y.example/b.png']);
  assert.deepEqual(urlFindings('a.css', 'a { b: c } // https://z.example/c.css'), ['https://z.example/c.css'], 'no // comments in CSS');
  // A line that merely starts with * in JS is code (a multiplication), not a comment continuation.
  assert.deepEqual(urlFindings('a.js', 'const n = 2\n  * f("https://m.example/x")'), ['https://m.example/x']);
  assert.deepEqual(urlFindings('a.js', "const s = ' // '; fetch('https://w.example/x');"), ['https://w.example/x']);
  assert.deepEqual(urlFindings('a.js', "x\n# y = 'https://h.example/x'"), ['https://h.example/x'], 'no # comments in JS');
  // A template is HTML: // and # there are text, not PHP comments.
  assert.deepEqual(urlFindings('Template/zine/a.php', '<a href=https://t.example/x>go</a> // https://u.example/'), ['https://t.example/x', 'https://u.example/']);
});

test('excluded files are matched by their path in the plugin, not by name anywhere', () => {
  for (const p of ['LICENSE', 'README.md', 'PROVENANCE.md', 'Assets/fonts/anton/OFL.txt', 'Test/js/x.test.mjs', '.git/config']) {
    assert.equal(skipped(p), true, p);
  }
  for (const p of ['Assets/README.md', 'Assets/js/LICENSE', 'Assets/OFL.txt', 'Assets/fonts/OFL.txt', 'Model/Test/x.php', 'plugin.json']) {
    assert.equal(skipped(p), false, p);
  }
});

test('no shipped file names another origin', () => {
  const files = [...shipped(ROOT)];
  assert.ok(files.some((f) => f.endsWith('Assets/js/app/main.js')) && files.some((f) => f.endsWith('Plugin.php')), 'the scan sees the plugin');
  const findings = files.flatMap((f) => urlFindings(relative(ROOT, f), readFileSync(f, 'utf8')).map((u) => `${relative(ROOT, f)}: ${u}`));
  assert.deepEqual(findings, []);
});
