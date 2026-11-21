// The stickers bundled with the plugin (Assets/stickers, CC0, PROVENANCE.md): name and the SVG's own px size.

const DIR = '../../stickers/';

/** The same-origin URL of a sticker's SVG file (Assets/stickers, beside Assets/js). */
export const stickerUrl = (name) => new URL(`${DIR}${name}.svg`, import.meta.url).href;
export const STICKERS = Object.freeze([
  { name: 'star-burst', w: 400, h: 400 },
  { name: 'arrow', w: 400, h: 200 },
  { name: 'underline', w: 400, h: 100 },
  { name: 'fold-here', w: 400, h: 160 },
  { name: 'hot-dog', w: 400, h: 200 },
].map((s) => Object.freeze(s)));
