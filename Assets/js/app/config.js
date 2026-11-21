// The editor's boot config, written by Template/zine/editor.php as a JSON block (Model/EditorConfig.php builds
// it). No DOM here: main.js finds the block and hands its text over.

/**
 * @typedef {{load: string, save: string, upload: string, pdf: string, image: string, export: string, list: string}} Routes
 * @typedef {{routes: Routes, csrf_token: string, zine_id: number, project_id: number, revision: number,
 *   can_edit: boolean, paper: string, user_lang: string, strings: Record<string, string>}} EditorConfig
 */

const FIELDS = ['routes', 'csrf_token', 'zine_id', 'project_id', 'revision', 'can_edit', 'paper', 'user_lang', 'strings'];
const ROUTES = ['load', 'save', 'upload', 'pdf', 'image', 'export', 'list'];

/**
 * Parses and checks the config text; throws naming the first missing field.
 * @param {string} text
 * @returns {EditorConfig}
 */
export function readConfig(text) {
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    throw new Error('Hot Dog Press: the editor config is not JSON');
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Hot Dog Press: the editor config is not an object');
  }
  for (const key of FIELDS) {
    if (!(key in config)) throw new Error(`Hot Dog Press: the editor config has no ${key}`);
  }
  for (const key of ROUTES) {
    if (typeof config.routes?.[key] !== 'string') throw new Error(`Hot Dog Press: the editor config has no routes.${key}`);
  }
  return config;
}

/**
 * The URL of one uploaded image.
 * @param {EditorConfig} config
 * @param {number} fileId
 */
export const imageUrl = (config, fileId) => config.routes.image.replace('{file_id}', String(fileId));

/**
 * Fills each `%s` in a translated string, in order. The server already turned `%%` into `%`.
 * @param {string} str
 * @param {...(string|number)} args
 */
export function fill(str, ...args) {
  let i = 0;
  return str.replace(/%s/g, () => (i < args.length ? String(args[i++]) : '%s'));
}
