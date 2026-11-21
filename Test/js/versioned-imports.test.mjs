// Cache-busting without a build: every relative import in the app carries `?v=<plugin.json version>`, so an upgrade
// changes every module URL and no browser mixes new and week-old cached modules (Kanboard serves .js with a 7-day
// expiry). Test/tools/version-imports.mjs writes them; this test fails when one is missing or behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { specifiers, sources, versionImports } from '../tools/version-imports.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')).version;

test('every relative import in Assets/js names the plugin version', () => {
  const files = sources();
  assert.ok(files.length > 40, 'the scan sees the app');
  const bad = [];
  let seen = 0;
  for (const file of files) {
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue;
      seen++;
      if (!spec.endsWith(`.js?v=${VERSION}`)) bad.push(`${file.replace(/.*Assets\/js\//, '')}: ${spec}`);
    }
  }
  assert.ok(seen > 100, `found ${seen} imports`);
  assert.deepEqual(bad, []);
});

test('specifiers finds static imports, re-exports and dynamic import()', () => {
  const src = `import { a } from './a.js';\nimport './side.js?v=0';\nexport { b } from "../b.js";\nimport {\n  c,\n} from './c.js';\nconst m = await import('./d.js');\n// import './comment.js'\n * @param {import('./type.js').T} t\nconst s = "import x from './not-code.js'";`;
  assert.deepEqual(specifiers(src), ['./a.js', './side.js?v=0', '../b.js', './c.js', './d.js']);
});

test('versionImports sets or replaces the version and leaves everything else alone', () => {
  const src = `import { a } from './a.js';\nimport './b.js?v=0.0.1';\nconst m = await import('../c.js');\nconst t = 'from "./x.js"';`;
  assert.equal(versionImports(src, '1.2.3'),
    `import { a } from './a.js?v=1.2.3';\nimport './b.js?v=1.2.3';\nconst m = await import('../c.js?v=1.2.3');\nconst t = 'from "./x.js"';`);
  assert.equal(versionImports(versionImports(src, '1.2.3'), '1.2.3'), versionImports(src, '1.2.3'), 'idempotent');
});
