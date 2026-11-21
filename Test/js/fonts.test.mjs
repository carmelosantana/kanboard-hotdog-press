// The bundled fonts: every family the looks name first has an @font-face in hotdogpress.css pointing at a font file
// in the plugin, with its OFL licence beside it and a sha256 in PROVENANCE.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOOKS } from '../../Assets/js/core/looks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(ROOT, 'Assets/css/hotdogpress.css'), 'utf8');
const provenance = readFileSync(join(ROOT, 'PROVENANCE.md'), 'utf8');

test('each look font family has a self-hosted @font-face with its file, licence and checksum', () => {
  const families = new Set(Object.values(LOOKS).flatMap((l) => Object.values(l.fonts).map((s) => /^"([^"]+)"/.exec(s)[1])));
  assert.equal(families.size, 3);
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
  for (const family of families) {
    const face = faces.find((f) => f.includes(`font-family: "${family}"`));
    assert.ok(face, `@font-face for ${family}`);
    const url = /url\("\.\.\/fonts\/([^"]+)"\)/.exec(face)?.[1];
    assert.ok(url, `${family} points at ../fonts/`);
    const file = join(ROOT, 'Assets/fonts', url);
    assert.ok(existsSync(file), url);
    const licence = readFileSync(join(dirname(file), 'OFL.txt'), 'utf8');
    assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/);
    const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
    assert.ok(provenance.includes(sha), `PROVENANCE.md lists the sha256 of ${url}`);
  }
});

test('no @font-face or url() reaches another origin', () => {
  assert.doesNotMatch(css, /url\(\s*["']?(https?:)?\/\//);
});
