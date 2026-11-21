// A photo from the device to the zine: decode, downscale to at most UPLOAD_MAX_PX on the long edge, re-encode
// (PNG stays PNG, the rest become JPEG at 0.9) and POST it to the upload route with the reusable CSRF token.
import { downscale } from './viewmath.js';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

/** A failure the editor shows with one of its strings. */
export class PhotoError extends Error {
  /** @param {'upload_types'|'upload_too_large'|'upload_failed'} key */
  constructor(key) {
    super(key);
    this.key = key;
  }
}

/**
 * @param {File} file
 * @param {import('./config.js').EditorConfig} config
 * @returns {Promise<{file_id: number, w: number, h: number, bitmap: ImageBitmap, name: string}>}
 */
export async function uploadPhoto(file, config) {
  if (!TYPES.includes(file.type)) throw new PhotoError('upload_types');
  let source;
  try {
    source = await createImageBitmap(file);
  } catch {
    throw new PhotoError('upload_types');
  }
  const { w, h } = downscale(source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).drawImage(source, 0, 0, w, h);
  source.close();
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new PhotoError('upload_failed');
  if (blob.size > MAX_BYTES) throw new PhotoError('upload_too_large');

  const name = file.name.replace(/\.[^.]*$/, '') + (type === 'image/png' ? '.png' : '.jpg');
  const form = new FormData();
  form.append('csrf_token', config.csrf_token);
  form.append('image', blob, name);
  let res;
  try {
    res = await fetch(config.routes.upload, { method: 'POST', body: form, credentials: 'same-origin' });
  } catch {
    throw new PhotoError('upload_failed');
  }
  if (res.status === 413) throw new PhotoError('upload_too_large');
  if (res.status === 415) throw new PhotoError('upload_types');
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok || !Number.isInteger(json.file_id)) throw new PhotoError('upload_failed');
  return { file_id: json.file_id, w, h, bitmap: await createImageBitmap(blob), name };
}
