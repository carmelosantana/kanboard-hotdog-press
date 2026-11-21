// Privacy: the plugin names no other origin. Every shipped text file is scanned for http:// and https:// outside
// comments. Allowed: LICENSE, README, PROVENANCE and the font licences (OFL.txt), the plugin.json homepage (also
// returned by Plugin::getPluginHomepage), and the SVG/XLink namespace names, which are identifiers, never fetched.
// Test/ is not shipped (the E2E points at the localhost dev stack on purpose).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const HOMEPAGE = JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8')).homepage;
const SKIP_DIRS = new Set(['.git', 'Test', 'node_modules']);
const SKIP_FILES = new Set(['LICENSE', 'README.md', 'PROVENANCE.md', 'OFL.txt']);
const BINARY = /\.(ttf|otf|woff2?|png|jpe?g|webp|gif|ico|zip|pdf)$/i;
const NAMESPACES = ['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink'];
const URL_RE = /https?:\/\/[^\s'"`<>)]+/g;

/**
 * The URLs in `text` that are not in a comment and not allowed. A URL is in a comment when, on its line, a comment
 * opener comes before it: `//` after whitespace or at the line start (a URL's own `//` follows a colon), `/*`, `<!--`,
 * `#` at the line start; or the line is a block-comment continuation starting with `*`.
 * @param {string} text
 * @returns {string[]}
 */
function urlFindings(text) {
  const found = [];
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(URL_RE)) {
      const url = m[0];
      if (url === HOMEPAGE || NAMESPACES.includes(url)) continue;
      const before = line.slice(0, m.index);
      const comment = /(^|\s)\/\/|\/\*|<!--/.test(before) || /^\s*(\*|#)/.test(line);
      if (!comment) found.push(url);
    }
  }
  return found;
}

function* shipped(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* shipped(path);
    } else if (!SKIP_FILES.has(basename(path)) && !BINARY.test(path)) {
      yield path;
    }
  }
}

test('urlFindings flags URLs in code and strings, not in comments, namespaces or the homepage', () => {
  assert.deepEqual(urlFindings("fetch('https://cdn.example.com/x.js');"), ['https://cdn.example.com/x.js']);
  assert.deepEqual(urlFindings('<link href="http://fonts.example.com/a.css">'), ['http://fonts.example.com/a.css']);
  assert.deepEqual(urlFindings('@import url(https://e.example/f.css);'), ['https://e.example/f.css']);
  assert.deepEqual(urlFindings('const a = 1; // see https://example.com'), []);
  assert.deepEqual(urlFindings(' * @see https://example.com\n/* https://example.com */\n# https://example.com'), []);
  assert.deepEqual(urlFindings('<!-- https://example.com -->'), []);
  assert.deepEqual(urlFindings('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'), []);
  assert.deepEqual(urlFindings(`return '${HOMEPAGE}';`), []);
  assert.deepEqual(urlFindings(`return '${HOMEPAGE}/evil';`), [`${HOMEPAGE}/evil`]);
});

test('no shipped file names another origin', () => {
  const files = [...shipped(ROOT)];
  assert.ok(files.some((f) => f.endsWith('Assets/js/app/main.js')) && files.some((f) => f.endsWith('Plugin.php')), 'the scan sees the plugin');
  const findings = files.flatMap((f) => urlFindings(readFileSync(f, 'utf8')).map((u) => `${relative(ROOT, f)}: ${u}`));
  assert.deepEqual(findings, []);
});
