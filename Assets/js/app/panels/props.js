// The options row under the toolbar: shape kinds for the shape tool, the sticker tray, ink colours, and for a selected
// item its colour (and font and size for text). Empty for viewers.
import { h } from '../dom.js';
import { addAsset, addItem, findItem, stickerItem, updateItem } from '../edit.js';
import { colorOf } from '../../core/looks.js';
import { STICKERS, stickerUrl } from '../stickers.js';

const COLORS = ['toner', 'paper', 'mustard', 'ketchup', 'kraft', 'copy', 'relish'];
const FONTS = ['display', 'body', 'mono'];
/** Text size steps, in panel-height units. */
const SIZE_STEP = 1.15;
const SIZE_MIN = 0.02;
const SIZE_MAX = 0.3;

/** @param {any} app */
export function createProps(app) {
  const { store, strings } = app;
  const el = h('div', { class: 'hdp-props', 'aria-live': 'off' });

  const swatches = (current, onpick) => h('div', { class: 'hdp-swatches', role: 'group', 'aria-label': strings.color },
    ...COLORS.map((token) => h('button', {
      type: 'button', class: 'hdp-swatch', title: strings[`color_${token}`], 'aria-label': strings[`color_${token}`],
      'aria-pressed': String(current === token), dataset: { token }, style: `background:${colorOf(store.doc.look, token)}`,
      onclick: () => onpick(token),
    })));

  const choice = (label, on, onclick) => h('button', { type: 'button', class: 'btn', 'aria-pressed': String(on), onclick }, label);

  async function addSticker(s) {
    const id = `sticker_${s.name.replace(/-/g, '_')}`;
    if (!store.doc.assets[id]) {
      const svg = await (await fetch(stickerUrl(s.name))).text();
      const data = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      store.update((d) => addAsset(d, id, { kind: 'sticker', name: s.name, data, w: s.w, h: s.h }));
    }
    const item = stickerItem(id);
    store.update((d) => addItem(d, store.page, item));
    store.select([item.id]);
    app.setTool('select');
  }

  function sync() {
    if (!app.canEdit) {
      el.hidden = true;
      return;
    }
    const rows = [];
    const tool = app.ui.tool;
    if (tool === 'shape') {
      rows.push(...['rect', 'ellipse'].map((k) => choice(strings[`shape_${k}`], app.ui.shapeKind === k, () => {
        app.ui.shapeKind = k;
        sync();
      })));
    } else if (tool === 'sticker') {
      rows.push(...STICKERS.map((s) => h('button', {
        type: 'button', class: 'hdp-sticker', title: strings[`sticker_${s.name}`], 'aria-label': strings[`sticker_${s.name}`],
        onclick: () => addSticker(s).catch((err) => console.warn('Hot Dog Press: sticker not added', err)),
      }, h('img', { src: stickerUrl(s.name), alt: '', width: 48, height: Math.round((48 * s.h) / s.w) }))));
    } else if (tool === 'ink') {
      rows.push(swatches(app.ui.inkColor, (t) => { app.ui.inkColor = t; sync(); }));
    } else {
      const it = store.selection.length === 1 ? findItem(store.doc, store.selection[0])?.item : null;
      if (it && it.locked !== true) {
        const set = (patch) => store.update((d) => updateItem(d, it.id, patch));
        if (it.type === 'text') {
          rows.push(swatches(it.color, (t) => set({ color: t })));
          rows.push(h('select', { 'aria-label': strings.font, onchange: (e) => set({ font: e.target.value }) },
            ...FONTS.map((f) => h('option', { value: f, selected: it.font === f }, strings[`font_${f}`]))));
          const size = (k) => () => set({ size: Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round((it.size ?? 0.045) * k * 1e4) / 1e4)) });
          rows.push(h('button', { type: 'button', class: 'btn', 'aria-label': strings.smaller, title: strings.smaller, onclick: size(1 / SIZE_STEP) }, 'A−'));
          rows.push(h('button', { type: 'button', class: 'btn', 'aria-label': strings.bigger, title: strings.bigger, onclick: size(SIZE_STEP) }, 'A+'));
        } else if (it.type === 'shape') {
          rows.push(swatches(it.fill, (t) => set({ fill: t })));
        } else if (it.type === 'ink') {
          rows.push(swatches(it.color, (t) => set({ color: t })));
        }
      }
    }
    el.replaceChildren(...rows);
  }
  return { el, sync };
}
