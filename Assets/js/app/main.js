// Boots the zine editor on Template/zine/editor.php: reads the JSON config, loads the zine, mounts the editor. A broken
// config or a failed load shows a plain message instead of a stuck "Loading".
import { readConfig } from './config.js?v=0.1.1';
import { validateDog } from '../core/dog.js?v=0.1.1';
import { mountEditor } from './editor.js?v=0.1.1';
import { recoverBuffer } from './autosave.js?v=0.1.1';
import { sessionStore } from './saving.js?v=0.1.1';

const root = document.getElementById('hotdogpress-app');
/** Shown when the config itself cannot be read: the template's translated line (English if even that is missing). */
const NO_CONFIG = root?.dataset.error || 'The editor could not start. Reload the page to try again.';
const block = document.getElementById('hotdogpress-config');

/** The mounted editor (its store and UI state), for later tasks and tests; null until loaded. */
export let editor = null;

/** Resolves when the editor is mounted (true) or has shown an error (false). */
export const ready = root && block ? boot(root, block.textContent ?? '') : Promise.resolve(false);

async function boot(root, text) {
  let config;
  try {
    config = readConfig(text);
  } catch (err) {
    console.error(err);
    return fail(root, NO_CONFIG);
  }
  try {
    const res = await fetch(config.routes.load, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`load: HTTP ${res.status}`);
    const body = await res.json();
    const checked = validateDog(body.document);
    if (!checked.ok) throw new Error(`load: ${JSON.stringify(checked.errors.slice(0, 3))}`);
    config.can_edit = body.can_edit === true && config.can_edit === true;
    const loaded = { doc: checked.dog, revision: body.revision ?? config.revision };
    // A member's tab may hold edits the server never acknowledged (a reload mid-edit): those win.
    const { doc, revision, dirty } = config.can_edit ? recoverBuffer(sessionStore(), config.zine_id, loaded) : { ...loaded, dirty: false };
    config.revision = revision;
    editor = mountEditor(root, config, doc, { dirty });
    return true;
  } catch (err) {
    console.error('Hot Dog Press:', err);
    return fail(root, config.strings.load_failed ?? NO_CONFIG);
  }
}

function fail(root, message) {
  const p = document.createElement('p');
  p.className = 'hotdogpress-error';
  p.setAttribute('role', 'alert');
  p.textContent = message;
  root.replaceChildren(p);
  root.dataset.ready = 'error';
  return false;
}
