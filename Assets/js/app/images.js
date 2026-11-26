// Decoded images for the renderer, by asset id. Uploaded photos are fetched from the zine's image route and decoded
// with createImageBitmap; inline (data: URL) assets such as stickers decode through an <img> with that data: URL.
// Never a blob: URL in an <img>: Kanboard's CSP allows only `img-src * data:`.
import { imageUrl } from './config.js?v=0.1.2';
import { isFileId } from '../core/dog.js?v=0.1.2';

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
  /** source key → promise of its decoded image (null on failure): many asset ids naming one source share one fetch. */
  const sources = new Map();

  function decode(asset) {
    return (async () => {
      try {
        if (typeof asset.data === 'string' && asset.data.startsWith('data:image/')) {
          const img = new Image();
          img.src = asset.data;
          await img.decode();
          return img;
        }
        if (isFileId(asset.file_id)) {
          const res = await fetch(imageUrl(config, asset.file_id), { credentials: 'same-origin' });
          if (!res.ok) throw new Error(`image ${asset.file_id}: HTTP ${res.status}`);
          return await createImageBitmap(await res.blob());
        }
      } catch (err) {
        console.warn('Hot Dog Press: an image could not be loaded', err);
      }
      return null; // neither an image data: URL nor a project file, or it failed
    })();
  }

  async function load(id, asset, key) {
    if (!sources.has(key)) sources.set(key, decode(asset));
    const drawable = await sources.get(key);
    if (!drawable || keys.get(id) !== key) return;
    ready[id] = drawable;
    onReady();
  }

  return {
    /** The decoded images, by asset id (what render.js takes). */
    get map() { return ready; },

    /** Starts loading every asset an item of the Dog uses that is not loaded yet; unused assets are never fetched. */
    sync(doc) {
      for (const id of usedAssets(doc)) {
        if (!Object.hasOwn(doc.assets ?? {}, id)) continue;
        const asset = doc.assets[id];
        const key = isFileId(asset?.file_id) ? `file:${asset.file_id}`
          : asset?.file_id == null && typeof asset?.data === 'string' ? `data:${asset.data}`
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
      const key = asset.file_id != null ? `file:${asset.file_id}` : `put:${id}`;
      keys.set(id, key);
      sources.set(key, Promise.resolve(drawable));
      ready[id] = drawable;
      onReady();
    },
  };
}

/** The asset ids the Dog's items name, once each. */
function usedAssets(doc) {
  const ids = new Set();
  for (const page of Array.isArray(doc.pages) ? doc.pages : []) {
    for (const item of Array.isArray(page?.items) ? page.items : []) {
      if (typeof item?.asset === 'string') ids.add(item.asset);
    }
  }
  return ids;
}
