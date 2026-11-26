// The Booklet view: flip through the folded zine — the cover alone, three spreads, the back cover alone.
import { renderPage } from '../../core/render.js?v=0.1.2';
import { panelSize } from '../../core/paper.js?v=0.1.2';
import { fitInto, SPREADS } from '../viewmath.js?v=0.1.2';
import { h, sizeCanvas } from '../dom.js?v=0.1.2';

/** @param {any} app */
export function createBookletView(app) {
  const { store, strings } = app;
  let spread = 0;
  const left = h('canvas', { class: 'hdp-booklet-page', role: 'img' });
  const right = h('canvas', { class: 'hdp-booklet-page', role: 'img' });
  const label = h('span', { class: 'hdp-booklet-label', 'aria-live': 'polite' });
  const prev = h('button', { type: 'button', class: 'btn hdp-flip', 'aria-label': strings.prev_page, onclick: () => flip(-1) }, '‹');
  const next = h('button', { type: 'button', class: 'btn hdp-flip', 'aria-label': strings.next_page, onclick: () => flip(1) }, '›');
  const spreadEl = h('div', { class: 'hdp-spread' }, left, right);
  const el = h('div', { class: 'hdp-view hdp-view-booklet', tabindex: '0' },
    spreadEl, h('div', { class: 'hdp-booklet-nav' }, prev, label, next));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') flip(-1);
    if (e.key === 'ArrowRight') flip(1);
  });
  let W = 0;
  let H = 0;

  function flip(d) {
    spread = Math.min(SPREADS.length - 1, Math.max(0, spread + d));
    app.render();
  }

  return {
    el,
    layout(maxW, maxH) {
      const { w, h: ph } = panelSize(store.doc.paper);
      ({ w: W, h: H } = fitInto(w * 2, ph, maxW, maxH - 48));
      W = Math.floor(W / 2);
    },
    render() {
      const pages = SPREADS[spread];
      // A lone cover sits on the right (the book's front), a lone back cover on the left.
      const slots = pages.length === 2 ? pages : spread === 0 ? [null, pages[0]] : [pages[0], null];
      [left, right].forEach((canvas, i) => {
        const p = slots[i];
        canvas.hidden = p === null;
        if (p === null) return;
        renderPage(sizeCanvas(canvas, W, H), store.doc, p, { px_w: W, px_h: H, images: app.images.map });
        canvas.setAttribute('aria-label', app.fill(strings.page_n, p + 1));
      });
      label.textContent = app.fill(strings.page_n, pages.map((p) => p + 1).join('–'));
      prev.disabled = spread === 0;
      next.disabled = spread === SPREADS.length - 1;
    },
  };
}
