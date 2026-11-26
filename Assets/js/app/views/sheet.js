// The Sheet view: the true imposition as it prints (top row upside down) with the fold and cut guides. Tap a panel to
// open that page in the Pages view.
import { renderSheet } from '../../core/render.js?v=0.1.2';
import { panelRect } from '../../core/impose.js?v=0.1.2';
import { resolvePaper } from '../../core/paper.js?v=0.1.2';
import { fitInto } from '../viewmath.js?v=0.1.2';
import { h, sizeCanvas } from '../dom.js?v=0.1.2';

/** @param {any} app */
export function createSheetView(app) {
  const { store } = app;
  const canvas = h('canvas', { class: 'hdp-sheet-canvas', role: 'img', 'aria-label': app.strings.view_sheet });
  const el = h('div', { class: 'hdp-view hdp-view-sheet' }, canvas);
  let W = 0;
  let H = 0;

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const paper = resolvePaper(store.doc.paper);
    const k = W / paper.w_mm;
    const [x, y] = [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
    for (let p = 1; p <= 8; p++) {
      const c = panelRect(paper, p);
      if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) {
        store.setPage(p - 1);
        app.setView('pages');
        return;
      }
    }
  });

  return {
    el,
    layout(maxW, maxH) {
      const paper = resolvePaper(store.doc.paper);
      ({ w: W, h: H } = fitInto(paper.w_mm, paper.h_mm, maxW, maxH));
    },
    render() {
      const paper = resolvePaper(store.doc.paper);
      renderSheet(sizeCanvas(canvas, W, H), store.doc, { px_per_mm: W / paper.w_mm, images: app.images.map, guides: true });
    },
  };
}
