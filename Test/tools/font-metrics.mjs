// Measures the bundled fonts in headless Chromium (Playwright from the harness root's node_modules) and prints the
// numbers core/fontmetrics.js holds, in em: ascent = highest ink of the tallest glyphs a zine uses (accented capitals,
// ¿ ¡, ascenders), descent = lowest ink of the deepest ones, glyph = average advance over bilingual prose.
// No network: the fonts are read from Assets/fonts and handed to FontFace as bytes.
// Run from the harness root: node HotDogPress/Test/tools/font-metrics.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TALL = 'ÁÉÍÓÚÑÜÀÈÌÒÙÂÊÎÔÛÇ¿¡ÅbdfhklĹŃ';
export const DEEP = 'gjpqyçÇ¿;,ŞĄ_';
/** Prose for the average advance: the Plant Medicine fixture's bilingual body text. */
const PROSE = readFileSync(join(PLUGIN, 'Test/fixtures/mustard/plant-medicine.mustard.md'), 'utf8')
  .split('\n').filter((l) => l && !/^(---|:::|#|!|\w+:)/.test(l)).join(' ');
const FONTS = {
  display: ['Anton', 'anton/Anton-Regular.ttf'],
  body: ['Atkinson Hyperlegible', 'atkinson-hyperlegible/AtkinsonHyperlegible-Regular.ttf'],
  mono: ['Courier Prime', 'courier-prime/CourierPrime-Regular.ttf'],
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const out = {};
  for (const [role, [family, file]] of Object.entries(FONTS)) {
    const bytes = [...readFileSync(join(PLUGIN, 'Assets/fonts', file))];
    out[role] = await page.evaluate(async ({ family, bytes, TALL, DEEP, PROSE }) => {
      const face = new FontFace(family, new Uint8Array(bytes));
      await face.load();
      document.fonts.add(face);
      const g = new OffscreenCanvas(10, 10).getContext('2d');
      g.font = `1000px "${family}"`;
      g.textBaseline = 'alphabetic';
      let ascent = 0;
      for (const c of TALL) ascent = Math.max(ascent, g.measureText(c).actualBoundingBoxAscent);
      let descent = 0;
      for (const c of DEEP) descent = Math.max(descent, g.measureText(c).actualBoundingBoxDescent);
      const glyph = g.measureText(PROSE).width / [...PROSE].length;
      const r = (n) => Math.ceil(n) / 1000;
      return { ascent: r(ascent), descent: r(descent), glyph: r(glyph) };
    }, { family, bytes, TALL, DEEP, PROSE });
  }
  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser.close();
}
