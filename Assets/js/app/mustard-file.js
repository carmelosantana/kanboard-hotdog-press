// .mustard.md files in the browser: the zine as a Mustard download, and a picked file's text for the Mustard panel
// (which compiles and applies it as if it were typed). Mustard never goes to the server as Mustard.
import { exportMustard, MAX_MUSTARD_BYTES, MUSTARD_TOO_LARGE } from '../core/mustard.js?v=0.1.2';
import { slug } from '../core/social.js?v=0.1.2';

/**
 * The zine as a `.mustard.md` file named from its title.
 * @param {any} dog
 * @returns {{name: string, type: string, data: Uint8Array}}
 */
export function mustardFile(dog) {
  return { name: `${slug(dog.title)}.mustard.md`, type: 'text/markdown', data: new TextEncoder().encode(exportMustard(dog).text) };
}

/**
 * A picked file's text, or the compiler's size error without reading a file over the limit.
 * @param {{size: number, text(): Promise<string>}} file
 * @returns {Promise<{text: string}|{error: {path: string, message: string}}>}
 */
export async function readMustardFile(file) {
  if (file.size > MAX_MUSTARD_BYTES) return { error: { path: '', message: MUSTARD_TOO_LARGE } };
  return { text: await file.text() };
}
