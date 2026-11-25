// The page strip: eight thumbnails in reading order. Tap one to open it. Reorder with the mouse by dragging, or on a
// touch screen by holding a page and then tapping where it goes. Moving a page moves its contents.
import { renderPage } from '../../core/render.js?v=0.1.1';
import { panelSize } from '../../core/paper.js?v=0.1.1';
import { movePage } from '../edit.js?v=0.1.1';
import { dropIndex, fitInto } from '../viewmath.js?v=0.1.1';
import { h, sizeCanvas } from '../dom.js?v=0.1.1';

const DRAG_PX = 8;
const HOLD_MS = 450;
const THUMB_H = 84;

/** @param {any} app */
export function createStrip(app) {
  const { store, strings } = app;
  const thumbs = Array.from({ length: 8 }, (_, i) => {
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    const button = h('button', { type: 'button', class: 'hdp-thumb', dataset: { index: String(i) } },
      canvas, h('span', { class: 'hdp-thumb-label' }, String(i + 1)));
    return { button, canvas };
  });
  const hint = h('p', { class: 'hdp-strip-hint' }, app.canEdit ? strings.reorder_hint : '');
  const list = h('div', { class: 'hdp-strip-list' }, ...thumbs.map((t) => t.button));
  const el = h('nav', { class: 'hdp-strip', 'aria-label': strings.pages_strip }, list, hint);

  /** @type {{from: number, x0: number, y0: number, dragging: boolean, timer: any, id: number}|null} */
  let press = null;
  /** A page picked up on a touch screen, waiting for the tap that drops it. */
  let picked = null;
  let suppressClick = false;

  const centres = () => thumbs.map((t) => {
    const r = t.button.getBoundingClientRect();
    return r.left + r.width / 2;
  });
  const drop = (from, to) => {
    if (from !== to) store.update((d) => movePage(d, from, to));
    store.setPage(to);
  };

  thumbs.forEach(({ button }, i) => {
    button.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      if (picked !== null) {
        const from = picked;
        picked = null;
        hint.textContent = strings.reorder_hint;
        drop(from, i);
        return;
      }
      store.setPage(i);
      if (app.ui.view !== 'pages') app.setView('pages');
    });
    if (!app.canEdit) return;
    button.addEventListener('pointerdown', (e) => {
      press = { from: i, x0: e.clientX, y0: e.clientY, dragging: false, timer: null, id: e.pointerId };
      if (e.pointerType !== 'mouse') {
        press.timer = setTimeout(() => {
          picked = i;
          suppressClick = true;
          hint.textContent = app.fill(strings.reorder_pick, i + 1);
          sync();
        }, HOLD_MS);
      }
    });
  });

  window.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const far = Math.abs(e.clientX - press.x0) > DRAG_PX || Math.abs(e.clientY - press.y0) > DRAG_PX;
    if (far) clearTimeout(press.timer);
    if (e.pointerType !== 'mouse') return;
    if (!press.dragging && far) {
      press.dragging = true;
      thumbs[press.from].button.classList.add('is-dragging');
    }
    if (press.dragging) {
      const to = dropIndex(e.clientX, centres());
      thumbs.forEach((t, k) => t.button.classList.toggle('is-drop', k === to && k !== press?.from));
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    clearTimeout(press.timer);
    const p = press;
    press = null;
    thumbs.forEach((t) => t.button.classList.remove('is-dragging', 'is-drop'));
    if (p.dragging) {
      suppressClick = true;
      drop(p.from, dropIndex(e.clientX, centres()));
    }
  });
  window.addEventListener('pointercancel', () => {
    if (press) clearTimeout(press.timer);
    press = null;
  });

  function sync() {
    thumbs.forEach(({ button }, i) => {
      button.setAttribute('aria-current', String(i === store.page));
      button.setAttribute('aria-label', app.fill(strings.page_n, i + 1));
      button.classList.toggle('is-picked', i === picked);
    });
  }

  function render() {
    const { w, h: ph } = panelSize(store.doc.paper);
    const size = fitInto(w, ph, THUMB_H, THUMB_H);
    thumbs.forEach(({ canvas }, i) => {
      renderPage(sizeCanvas(canvas, size.w, size.h), store.doc, i, { px_w: size.w, px_h: size.h, images: app.images.map });
    });
    sync();
  }
  return { el, render, sync };
}
