// The Pages view: the current page drawn large by core/render.js, an overlay canvas above it for the safe area,
// empty text boxes, the selection and live tool strokes, and a textarea for typing into a text box in place.
// Pointer input goes to the active tool (tools/*.js).
import { renderPage, layoutText } from '../../core/render.js?v=0.1.1';
import { joinRuns, splitRuns } from '../../core/runs.js?v=0.1.1';
import { safeArea } from '../../core/impose.js?v=0.1.1';
import { panelSize } from '../../core/paper.js?v=0.1.1';
import { colorOf, lookOf } from '../../core/looks.js?v=0.1.1';
import { itemBox, toPx, handlePoints, hitTest } from '../geometry.js?v=0.1.1';
import { findItem, removeItems, updateItem } from '../edit.js?v=0.1.1';
import { fitInto } from '../viewmath.js?v=0.1.1';
import { h, sizeCanvas } from '../dom.js?v=0.1.1';

const SELECT = '#C8322B';

/** @param {any} app */
export function createPagesView(app) {
  const { store, strings } = app;
  const page = h('canvas', { class: 'hdp-page-canvas', role: 'img' });
  const overlay = h('canvas', { class: 'hdp-overlay', 'aria-hidden': 'true' });
  const editor = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'hdp-text-edit', spellcheck: 'true', maxlength: 2000, hidden: true }));
  const frame = h('div', { class: 'hdp-page-frame' }, page, overlay, editor);
  const el = h('div', { class: 'hdp-view hdp-view-pages' }, frame);

  let W = 0;
  let H = 0;
  /** @type {any} */
  let session = null;
  let lastPt = { x: 0, y: 0 };
  /** @type {{id: string, fresh: boolean}|null} */
  let editing = null;

  const items = () => store.doc.pages[store.page].items;
  const toPoint = (e) => {
    const r = overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const env = {
    app,
    get W() { return W; },
    get H() { return H; },
    get pageIndex() { return store.page; },
    items,
    toPoint,
    editText,
  };

  // ---------------------------------------------------------------- pointer input

  overlay.addEventListener('pointerdown', (e) => {
    if (!app.canEdit || e.button > 0) return;
    if (editing) closeEditor();
    e.preventDefault();
    const pt = toPoint(e);
    lastPt = pt;
    session = app.tool().down(env, pt, e) ?? null;
    if (session) overlay.setPointerCapture(e.pointerId);
    app.render();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!session) return;
    lastPt = toPoint(e);
    session.move(lastPt, e);
    if (session.preview) drawOverlay();
  });
  const end = (e) => {
    if (!session) return;
    const s = session;
    session = null;
    if (e.type === 'pointerup') s.up?.(toPoint(e), e);
    else s.up?.(lastPt, e);
    app.render();
  };
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);
  overlay.addEventListener('dblclick', (e) => {
    if (!app.canEdit) return;
    const id = hitTest(items(), toPoint(e), W, H);
    const item = id ? findItem(store.doc, id)?.item : null;
    if (item?.type === 'text' && item.locked !== true) editText(id);
  });

  // ---------------------------------------------------------------- typing in place

  /** @param {string} id @param {{fresh?: boolean}} [opts] fresh: removed again if left empty */
  function editText(id, { fresh = false } = {}) {
    editing = { id, fresh };
    editor.hidden = false;
    editor.value = joinRuns(findItem(store.doc, id)?.item);
    placeEditor();
    editor.focus();
    app.render();
  }

  function placeEditor() {
    const at = editing && findItem(store.doc, editing.id);
    if (!at) return;
    const it = at.item;
    const b = toPx(itemBox(it), W, H);
    const fonts = lookOf(store.doc.look).fonts;
    Object.assign(editor.style, {
      left: `${b.x}px`,
      top: `${b.y}px`,
      width: `${Math.max(b.w, 40)}px`,
      height: `${Math.max(b.h, 24)}px`,
      transform: b.rot ? `rotate(${b.rot}deg)` : '',
      font: `${(it.size ?? 0.045) * H}px ${fonts[it.font] ?? fonts.body}`,
      lineHeight: '1.2',
      textAlign: it.align ?? 'left',
      color: colorOf(store.doc.look, it.color),
    });
  }

  editor.addEventListener('input', () => {
    if (!editing) return;
    const id = editing.id;
    const item = findItem(store.doc, id)?.item;
    const runs = splitRuns(item, editor.value.slice(0, 2000));
    store.update((d) => updateItem(d, id, { runs, by: 'hand' }), { merge: `text:${id}` });
  });
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeEditor();
    }
    e.stopPropagation();
  });
  editor.addEventListener('blur', () => closeEditor());

  function closeEditor() {
    if (!editing) return;
    const { id, fresh } = editing;
    editing = null;
    editor.hidden = true;
    store.seal();
    if (fresh && editor.value.trim() === '') store.update((d) => removeItems(d, [id]));
    app.render();
  }

  // ---------------------------------------------------------------- drawing

  function layout(maxW, maxH) {
    const { w, h: ph } = panelSize(store.doc.paper);
    ({ w: W, h: H } = fitInto(w, ph, maxW, maxH));
    frame.style.width = `${W}px`;
    frame.style.height = `${H}px`;
  }

  function render() {
    const doc = store.doc;
    // While typing, the textarea shows the text, so the canvas leaves that box out.
    const shown = editing ? hideItem(doc, store.page, editing.id) : doc;
    renderPage(sizeCanvas(page, W, H), shown, store.page, { px_w: W, px_h: H, images: app.images.map });
    page.setAttribute('aria-label', app.fill(strings.page_n, store.page + 1));
    if (editing) placeEditor();
    drawOverlay();
  }

  function drawOverlay() {
    const ctx = sizeCanvas(overlay, W, H);
    const doc = store.doc;
    if (app.ui.safeArea) {
      const a = safeArea(doc.paper, doc.margin_mm, store.page + 1);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(78, 125, 50, 0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x * W + 0.5, a.y * H + 0.5, a.w * W - 1, a.h * H - 1);
      ctx.restore();
    }
    if (app.canEdit) {
      // Empty text boxes would be invisible: outline them faintly so there is something to tap.
      const measure = page.getContext('2d');
      for (const it of items()) {
        if (it.type !== 'text' || it.id === editing?.id) continue;
        if (layoutText(measure, it, W, H, doc.look).lines.some((l) => l.trim() !== '')) continue;
        outline(ctx, toPx(itemBox(it), W, H), 'rgba(27, 26, 23, 0.35)', [3, 3]);
      }
    }
    const sel = store.selection.length === 1 ? findItem(doc, store.selection[0]) : null;
    if (sel && sel.page === store.page) {
      const b = toPx(itemBox(sel.item), W, H);
      outline(ctx, b, SELECT, sel.item.locked ? [2, 3] : []);
      if (app.canEdit && sel.item.locked !== true && sel.item.id !== editing?.id) drawHandles(ctx, b);
    }
    if (session?.preview) session.preview(ctx, lastPt);
  }

  return {
    el,
    layout,
    render,
    get editing() { return editing?.id ?? null; },
    closeEditor,
  };
}

function hideItem(doc, pageIndex, id) {
  return {
    ...doc,
    pages: doc.pages.map((p, i) => (i === pageIndex ? { ...p, items: p.items.filter((it) => it.id !== id) } : p)),
  };
}

function outline(ctx, b, color, dash) {
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
  ctx.rotate((b.rot * Math.PI) / 180);
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
  ctx.restore();
}

function drawHandles(ctx, b) {
  const pts = handlePoints(b);
  ctx.save();
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const top = { x: (pts.nw.x + pts.ne.x) / 2, y: (pts.nw.y + pts.ne.y) / 2 };
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(pts.rot.x, pts.rot.y);
  ctx.stroke();
  for (const [name, p] of Object.entries(pts)) {
    ctx.beginPath();
    if (name === 'rot') ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
    else ctx.rect(p.x - 5, p.y - 5, 10, 10);
    ctx.fillStyle = '#FAF7F0';
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
