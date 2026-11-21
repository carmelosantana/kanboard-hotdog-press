// Looks: named themes that set colours by token, the font role stacks and the guide level. Pure, no DOM.
// The renderer and the print sheet's guide layer both read them, so screen and paper agree.
import { luminance } from './filters.js?v=0.1.0';

/**
 * Colour tokens. `paper` is the look's page colour and `toner` its ink (light on a dark look); the rest are the
 * brand accents (`copy` is copy paper).
 */
export const TOKENS = Object.freeze(['paper', 'toner', 'mustard', 'ketchup', 'kraft', 'copy', 'relish']);

const BRAND = Object.freeze({
  mustard: '#E8B517', ketchup: '#C8322B', kraft: '#D9C4A0', copy: '#FAF7F0', toner: '#1B1A17', relish: '#4E7D32',
});

/** Font roles to CSS font-family stacks; the font files themselves are loaded by the browser code. */
const FONTS = Object.freeze({
  display: '"Anton", "Arial Narrow", sans-serif',
  body: '"Atkinson Hyperlegible", "Helvetica Neue", Arial, sans-serif',
  mono: '"Courier Prime", "Courier New", monospace',
});

/**
 * @param {string} paper page colour
 * @param {string} toner ink colour
 * @param {0|1} guide gray level of the strongest guide mark: 0 (black) on light paper, 1 (white) on dark paper.
 *   Every GUIDE_STYLES gray is measured from it, so the guides read on the page whatever its colour.
 */
const look = (paper, toner, guide) => Object.freeze({
  colors: Object.freeze({ ...BRAND, paper, toner }),
  text: 'toner',
  fonts: FONTS,
  guide,
});

/** Named looks: colour per token, the token unknown colours fall back to, the font role stacks, the guide level. */
export const LOOKS = Object.freeze({
  kraft: look(BRAND.kraft, BRAND.toner, 0),
  'copy-shop': look(BRAND.copy, BRAND.toner, 0),
  night: look(BRAND.toner, BRAND.copy, 1),
});

/**
 * The named look; an unknown or missing name is kraft.
 * @param {unknown} name
 */
export const lookOf = (name) => (typeof name === 'string' && Object.hasOwn(LOOKS, name) ? LOOKS[name] : LOOKS.kraft);

/**
 * A token's colour in a look (unknown look: kraft; unknown token: the look's text colour). With `bw` the colour is
 * its luminance gray, so fills match photos run through filters.toGray.
 * @param {string} lookName
 * @param {string|undefined} token
 * @param {boolean} [bw]
 * @returns {string} `#RRGGBB`
 */
export function colorOf(lookName, token, bw = false) {
  const l = lookOf(lookName);
  const hex = (typeof token === 'string' && Object.hasOwn(l.colors, token)) ? l.colors[token] : l.colors[l.text];
  return bw ? grayHex(hex) : hex;
}

/**
 * `#RRGGBB` → its luminance gray `#GGGGGG`.
 * @param {string} hex
 */
export function grayHex(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return grayLevelHex(luminance((n >> 16) & 255, (n >> 8) & 255, n & 255) / 255);
}

/**
 * A gray level 0 (black)..1 (white) as `#GGGGGG`.
 * @param {number} level
 */
export function grayLevelHex(level) {
  const g = Math.round(Math.min(1, Math.max(0, level)) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${g}${g}${g}`;
}
