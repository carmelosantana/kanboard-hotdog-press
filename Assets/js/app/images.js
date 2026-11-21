// Decoded images for the renderer, by asset id. Uploaded photos are fetched from the zine's image route and decoded
// with createImageBitmap; inline (data: URL) assets such as stickers decode through an <img> with that data: URL.
// Never a blob: URL in an <img>: Kanboard's CSP allows only `img-src * data:`.
import { imageUrl } from './config.js';

/**
 * @param {import('./config.js').EditorConfig} config
 * @param {() => void} onReady called whenever another image is ready to draw
 */
export function createImages(config, onReady) {
  /** @type {Record<string, any>} */
  const ready = {};
  /** asset id → the source key being loaded or loaded, so a changed asset reloads. */
  const keys = new Map();

  async function load(id, asset, key) {
    try {
      let drawable;
      if (typeof asset.data === 'string' && asset.data.startsWith('data:image/')) {
        const img = new Image();
        img.src = asset.data;
        await img.decode();
        drawable = img;
      } else {
        const res = await fetch(imageUrl(config, asset.file_id), { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`image ${asset.file_id}: HTTP ${res.status}`);
        drawable = await createImageBitmap(await res.blob());
      }
      if (keys.get(id) !== key) return;
      ready[id] = drawable;
      onReady();
    } catch (err) {
      console.warn('Hot Dog Press: an image could not be loaded', err);
    }
  }

  return {
    /** The decoded images, by asset id (what render.js takes). */
    get map() { return ready; },

    /** Starts loading every asset of the Dog that is not loaded yet. */
    sync(doc) {
      for (const [id, asset] of Object.entries(doc.assets ?? {})) {
        const key = asset.file_id != null ? `file:${asset.file_id}` : typeof asset.data === 'string' ? `data:${asset.data.length}:${asset.data.slice(-32)}` : null;
        if (!key || keys.get(id) === key) continue;
        keys.set(id, key);
        delete ready[id];
        load(id, asset, key);
      }
    },

    /** An image decoded here already (a photo just uploaded), so it is not fetched again. */
    put(id, asset, drawable) {
      keys.set(id, asset.file_id != null ? `file:${asset.file_id}` : `put:${id}`);
      ready[id] = drawable;
      onReady();
    },
  };
}
