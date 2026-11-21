// The bundled stickers: each listed sticker is an SVG file in the plugin with the size the list gives, and nothing in
// it loads anything else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STICKERS } from '../../Assets/js/app/stickers.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Assets', 'stickers');

test('every sticker file is listed with its own width and height, and listed in PROVENANCE.md', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.svg')).sort();
  assert.deepEqual(STICKERS.map((s) => `${s.name}.svg`).sort(), files);
  assert.ok(files.length >= 4 && files.length <= 6);
  const provenance = readFileSync(join(DIR, '..', '..', 'PROVENANCE.md'), 'utf8');
  for (const s of STICKERS) {
    const svg = readFileSync(join(DIR, `${s.name}.svg`), 'utf8');
    assert.match(svg, new RegExp(`<svg[^>]* width="${s.w}" height="${s.h}"`), s.name);
    assert.doesNotMatch(svg, /href|<image|<script|url\(/, `${s.name} loads nothing`);
    assert.ok(provenance.includes(`Assets/stickers/${s.name}.svg`), `${s.name} in PROVENANCE.md`);
  }
});
