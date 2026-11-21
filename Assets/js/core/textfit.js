// Text fitting, one rule for the renderer and the layout budgets. Pure, no DOM.
//
// Lines sit on alphabetic baselines. The first baseline is the font's ascent below the box top, where the ascent is
// the highest ink of the tallest glyphs a zine uses (accented capitals, ¿ ¡), so nothing is clipped at the top; a
// line fits while its descent stays inside the box. Further lines follow at LINE_HEIGHT.

/** Line pitch as a multiple of the font size. */
export const LINE_HEIGHT = 1.2;

/**
 * Per font role, in em, measured from the bundled fonts by Test/tools/font-metrics.mjs (re-run it when a font
 * changes): ascent = highest ink above the baseline (Á É Í Ó Ú Ñ Ü ¿ ¡ and ascenders), descent = lowest ink below it,
 * glyph = average advance over bilingual prose (the layouts' budget estimate).
 * @type {Readonly<Record<'display'|'body'|'mono', Readonly<{ascent: number, descent: number, glyph: number}>>>}
 */
export const FONT_METRICS = Object.freeze({
  display: Object.freeze({ ascent: 1.235, descent: 0.313, glyph: 0.402 }), // Anton
  body: Object.freeze({ ascent: 0.875, descent: 0.204, glyph: 0.439 }), // Atkinson Hyperlegible
  mono: Object.freeze({ ascent: 0.907, descent: 0.235, glyph: 0.6 }), // Courier Prime
});

/** A role's metrics; an unknown role is body, as the renderer's font fallback is. @param {unknown} role */
export const metricsOf = (role) => (typeof role === 'string' && Object.hasOwn(FONT_METRICS, role)
  ? FONT_METRICS[/** @type {'display'|'body'|'mono'} */ (role)] : FONT_METRICS.body);

/**
 * How many lines of a role at `size` fit a box `box` tall (any unit, the same for both).
 * @param {number} box @param {number} size @param {unknown} role
 */
export function linesThatFit(box, size, role) {
  const { ascent, descent } = metricsOf(role);
  const first = (ascent + descent) * size;
  if (!(size > 0) || !(box >= first - 1e-9)) return 0;
  return Math.floor((box - first) / (LINE_HEIGHT * size) + 1e-9) + 1;
}

/** The height `lines` lines take, top of the tallest accent to the lowest descent. */
export function blockHeight(lines, size, role) {
  const { ascent, descent } = metricsOf(role);
  return lines > 0 ? (ascent + descent) * size + (lines - 1) * LINE_HEIGHT * size : 0;
}

/**
 * Greedy word wrap: breaks at "\n", fills each line while `fits(line)`, splits a word too long for a line. A box too
 * narrow for one character still makes progress (one character per line).
 * @param {string} text
 * @param {(s: string) => boolean} fits
 * @returns {string[]}
 */
export function wrapText(text, fits) {
  const lines = [];
  if (text === '') return lines;
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const joined = line ? `${line} ${word}` : word;
      if (fits(joined)) { line = joined; continue; }
      if (line) lines.push(line);
      line = '';
      let rest = word;
      while (rest && !fits(rest)) {
        const chars = [...rest];
        let n = 1;
        while (n < chars.length && fits(chars.slice(0, n + 1).join(''))) n++;
        lines.push(chars.slice(0, n).join(''));
        rest = chars.slice(n).join('');
      }
      line = rest;
    }
    if (line || para.trim() === '') lines.push(line);
  }
  return lines;
}
