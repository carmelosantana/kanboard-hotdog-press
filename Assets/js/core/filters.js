// Pixel filters for the black-and-white (photocopier) path, on ImageData-like objects ({width, height, data}
// with RGBA bytes). They change the pixels in place and return the same object. Pure, no DOM.

/**
 * Perceived brightness 0..255 of an sRGB colour (Rec. 601 weights, as photocopiers and JPEG luma use).
 * The renderer maps its colours through this too, so drawn fills and filtered photos agree.
 * @param {number} r @param {number} g @param {number} b
 * @returns {number} an integer 0..255
 */
export function luminance(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Grayscale in place: r = g = b = luminance; alpha is kept.
 * @template {{data: Uint8ClampedArray|number[]}} T
 * @param {T} imageData
 * @returns {T}
 */
export function toGray(imageData) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i + 1] = d[i + 2] = luminance(d[i], d[i + 1], d[i + 2]);
  }
  return imageData;
}

/**
 * Input levels in place: `black` and below become 0, `white` and above 255, linear between; per RGB channel,
 * alpha kept. Run after toGray to push a photo towards photocopier contrast.
 * @template {{data: Uint8ClampedArray|number[]}} T
 * @param {T} imageData
 * @param {number} black 0..254
 * @param {number} white black+1..255
 * @returns {T}
 */
export function levels(imageData, black, white) {
  if (!(black >= 0 && white <= 255 && white > black)) {
    throw new RangeError(`levels needs 0 <= black < white <= 255, got ${black}..${white}`);
  }
  const range = white - black;
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = i; c < i + 3; c++) d[c] = Math.min(255, Math.max(0, Math.round(((d[c] - black) * 255) / range)));
  }
  return imageData;
}
