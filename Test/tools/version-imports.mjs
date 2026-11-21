// Puts `?v=<plugin.json version>` on every relative import in Assets/js (static, re-export and dynamic import()),
// replacing an older one. Run it after bumping plugin.json: `node Test/tools/version-imports.mjs`.
// Test/js/versioned-imports.test.mjs fails until it has run. Zero dependencies; it only rewrites import specifiers.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// `import … from '…'` / `export … from '…'` at the start of a line (a comment or a string never starts one),
// a side-effect `import '…'`, and `import('…')` outside a comment line (JSDoc types use that form too).
const PATTERNS = [
  /^([ \t]*(?:import|export)\s+[\w*{}\s,$]+?\s+from\s*)(['"])([^'"\n]+)\2/gm,
  /^([ \t]*import\s*)(['"])([^'"\n]+)\2/gm,
  /^((?![ \t]*(?:\/?\*|\/\/)).*?\bimport\(\s*)(['"])([^'"\n]+)\2(?=\s*\))/gm,
];

/** Every import specifier in `src`, in source order. @param {string} src */
export function specifiers(src) {
  const found = [];
  for (const re of PATTERNS) for (const m of src.matchAll(re)) found.push([m.index, m[3]]);
  return found.sort((a, b) => a[0] - b[0]).map(([, spec]) => spec);
}

/** `src` with every relative specifier ending in `?v=<version>`. @param {string} src @param {string} version */
export function versionImports(src, version) {
  const tag = (spec) => (spec.startsWith('.') ? `${spec.replace(/\?v=[^'"]*$/, '')}?v=${version}` : spec);
  return PATTERNS.reduce((out, re) => out.replace(re, (_, head, q, spec) => `${head}${q}${tag(spec)}${q}`), src);
}

/** The app's .js files. */
export function sources(dir = join(ROOT, 'Assets/js')) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.name.endsWith('.js') ? [path] : [];
  }).sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8'));
  let changed = 0;
  for (const file of sources()) {
    const src = readFileSync(file, 'utf8');
    const out = versionImports(src, version);
    if (out !== src) { writeFileSync(file, out); changed++; }
  }
  console.log(`?v=${version}: ${changed} file(s) changed`);
}
