// The ink tool: draw with a pen, a finger or the mouse (Pointer Events, coalesced points). On release the stroke is
// smoothed and simplified and stored in panel units as a hand-made ink item.
import { addItem, inkItem } from '../edit.js?v=0.1.1';
import { finishStroke } from '../ink.js?v=0.1.1';
import { colorOf } from '../../core/looks.js?v=0.1.1';

const WIDTH = 0.008;

export const inkTool = {
  name: 'ink',

  down(env, start) {
    const { app, W, H } = env;
    const pts = [[start.x / W, start.y / H]];
    return {
      move(pt, e) {
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        for (const c of events.length ? events.map((ev) => env.toPoint(ev)) : [pt]) pts.push([c.x / W, c.y / H]);
      },
      up() {
        const item = inkItem(finishStroke(pts), { width: WIDTH, color: app.ui.inkColor });
        app.store.update((d) => addItem(d, env.pageIndex, item));
      },
      preview(ctx) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = WIDTH * W;
        ctx.strokeStyle = colorOf(app.store.doc.look, app.ui.inkColor);
        ctx.beginPath();
        ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
        for (const [x, y] of pts.length === 1 ? pts : pts.slice(1)) ctx.lineTo(x * W, y * H);
        ctx.stroke();
        ctx.restore();
      },
    };
  },
};
