// The select tool: pick the topmost item, move it, drag a corner to resize, the top knob to rotate (Shift snaps to
// 15°). Locked items can be picked (to unlock) but not moved. The page view opens a text box on double-click.
import { hitTest, itemBox, toPx, toUnits, handleAt, resizeBox, rotateTo, moveBy, boxPatch } from '../geometry.js?v=0.1.1';
import { findItem, updateItem } from '../edit.js?v=0.1.1';

const HANDLE_RADIUS = 14;
let drags = 0;

export const selectTool = {
  name: 'select',

  /** @param {any} env @param {{x: number, y: number}} pt view px @param {PointerEvent} e */
  down(env, pt, e) {
    const { app, W, H } = env;
    const { store } = app;
    const sel = store.selection.length === 1 ? findItem(store.doc, store.selection[0]) : null;
    if (sel && sel.page === env.pageIndex && sel.item.locked !== true) {
      const box = toPx(itemBox(sel.item), W, H);
      const handle = handleAt(box, pt, e.pointerType === 'mouse' ? 8 : HANDLE_RADIUS);
      if (handle) return startDrag(env, sel.item, handle, pt);
    }
    const id = hitTest(env.items(), pt, W, H, e.pointerType === 'mouse' ? 4 : 10);
    store.select(id ? [id] : []);
    if (!id) return null;
    const { item } = /** @type {any} */ (findItem(store.doc, id));
    return item.locked === true ? null : startDrag(env, item, 'move', pt);
  },
};

/** A drag session: every move replaces the item's geometry from where it started; one undo step for the drag. */
function startDrag(env, item, mode, start) {
  const { app, W, H } = env;
  const merge = `drag:${++drags}`;
  const box0 = toPx(itemBox(item), W, H);
  return {
    move(pt, e) {
      let patch;
      if (mode === 'move') patch = moveBy(item, (pt.x - start.x) / W, (pt.y - start.y) / H);
      else if (mode === 'rot') patch = boxPatch(item, toUnits({ ...box0, rot: rotateTo(box0, pt, e.shiftKey) }, W, H));
      else patch = boxPatch(item, toUnits(resizeBox(box0, mode, pt), W, H));
      app.store.update((d) => updateItem(d, item.id, patch), { merge });
    },
    up() { app.store.seal(); },
  };
}
