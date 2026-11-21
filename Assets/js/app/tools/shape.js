// The shape tool: drag out a rectangle or an ellipse (a tap drops one of the default size).
import { addItem, shapeItem } from '../edit.js?v=0.1.0';

const TAP_PX = 6;

export const shapeTool = {
  name: 'shape',

  down(env, start) {
    const { app, W, H } = env;
    return {
      move() {},
      up(pt) {
        const big = Math.abs(pt.x - start.x) > TAP_PX && Math.abs(pt.y - start.y) > TAP_PX;
        const box = big
          ? {
            x: Math.min(pt.x, start.x) / W, y: Math.min(pt.y, start.y) / H,
            w: Math.abs(pt.x - start.x) / W, h: Math.abs(pt.y - start.y) / H,
          }
          : {};
        const item = shapeItem({ x: start.x / W, y: start.y / H }, app.ui.shapeKind, box);
        app.store.update((d) => addItem(d, env.pageIndex, item));
        app.store.select([item.id]);
        app.setTool('select');
      },
      preview(ctx, pt) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#1B1A17';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const [x, y, w, h] = [start.x, start.y, pt.x - start.x, pt.y - start.y];
        if (app.ui.shapeKind === 'ellipse') {
          ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, 2 * Math.PI);
        } else ctx.rect(x, y, w, h);
        ctx.stroke();
        ctx.restore();
      },
    };
  },
};
