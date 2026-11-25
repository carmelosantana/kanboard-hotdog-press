// Decoded images for the renderer, by asset id. Uploaded photos are fetched from the zine's image route and decoded
// with createImageBitmap; inline (data: URL) assets such as stickers decode through an <img> with that data: URL.
// Never a blob: URL in an <img>: Kanboard's CSP allows only `img-src * data:`.
import { imageUrl } from './config.js?v=0.1.0';
import { isFileId } from '../core/dog.js?v=0.1.0';

/**
 * @param {import('./config.js').EditorConfig} config
 * @param {() => void} onReady called whenever another image is ready to draw
 */
export function createImages(config, onReady) {
  /** @type {Record<string, any>} */
  const ready = {};
  /** asset id → the source key being loaded or loaded, so a changed asset reloads. */
  const keys = new Map();
  /** Loads not finished yet. */
  const pending = new Set();

  async function load(id, asset, key) {
    try {
      let drawable;
      if (typeof asset.data === 'string' && asset.data.startsWith('data:image/')) {
        const img = new Image();
        img.src = asset.data;
        await img.decode();
        drawable = img;
      } else if (isFileId(asset.file_id)) {
        const res = await fetch(imageUrl(config, asset.file_id), { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`image ${asset.file_id}: HTTP ${res.status}`);
        drawable = await createImageBitmap(await res.blob());
      } else {
        return; // neither an image data: URL nor a project file
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
        const key = isFileId(asset?.file_id) ? `file:${asset.file_id}`
          : asset?.file_id == null && typeof asset?.data === 'string' ? `data:${asset.data.length}:${asset.data.slice(-32)}`
            : null; // a file_id that is not a positive integer is never filled into the route
        if (!key || keys.get(id) === key) continue;
        keys.set(id, key);
        delete ready[id];
        const job = load(id, asset, key).finally(() => pending.delete(job));
        pending.add(job);
      }
    },

    /** Starts loading the Dog's assets and resolves when every load has finished (loaded or failed): exports wait. */
    async settled(doc) {
      this.sync(doc);
      while (pending.size) await Promise.all([...pending]);
    },

    /** An image decoded here already (a photo just uploaded), so it is not fetched again. */
    put(id, asset, drawable) {
      keys.set(id, asset.file_id != null ? `file:${asset.file_id}` : `put:${id}`);
      ready[id] = drawable;
      onReady();
    },
  };
}
