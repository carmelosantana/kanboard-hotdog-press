// The text tool: tap the page to put a text box there and type; tap a text box to type in it.
import { hitTest } from '../geometry.js?v=0.1.2';
import { addItem, findItem, textItem } from '../edit.js?v=0.1.2';

export const textTool = {
  name: 'text',

  down(env, pt) {
    const { app, W, H } = env;
    const id = hitTest(env.items(), pt, W, H);
    const hit = id ? findItem(app.store.doc, id)?.item : null;
    if (hit?.type === 'text' && hit.locked !== true) {
      app.store.select([id]);
      env.editText(id);
      return null;
    }
    const item = textItem({ x: Math.min(pt.x / W, 0.35), y: pt.y / H });
    app.store.update((d) => addItem(d, env.pageIndex, item));
    app.store.select([item.id]);
    env.editText(item.id, { fresh: true });
    app.setTool('select');
    return null;
  },
};
