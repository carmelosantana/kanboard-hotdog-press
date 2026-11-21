// The autosave client. Every change is written to a sessionStorage buffer at once and POSTed to the save route 2 s
// after the last one, with the revision it was based on. The buffer goes when the server acknowledges. On pagehide
// unsaved edits go out with sendBeacon (the buffer stays: a beacon is never acknowledged, and one over the browser's
// beacon size limit is dropped). A 409 opens the conflict prompt, unless the server copy is exactly what was sent
// (a beacon landed first). The browser APIs come in through `env`, so this runs under Node for the tests.
import { validateDog } from '../core/dog.js';

/** Debounce after the last edit. */
export const AUTOSAVE_DELAY_MS = 2000;
/** First retry after a failed save; it doubles up to RETRY_MAX_MS. */
export const RETRY_MS = 5000;
export const RETRY_MAX_MS = 60000;

/** @param {number} zineId */
export const bufferKey = (zineId) => `hotdogpress:zine:${zineId}`;

/**
 * @typedef {{getItem(k: string): string|null, setItem(k: string, v: string): void, removeItem(k: string): void}} Storage
 * @typedef {{fetch: typeof fetch, storage: Storage, sendBeacon: (url: string, body: FormData) => boolean,
 *   setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout}} Env
 * @typedef {'dirty'|'saving'|'saved'|'error'|'conflict'} SaveState
 */

/**
 * On boot: the zine to open, given what the server sent and what this tab buffered. A buffer equal to the server
 * copy is dropped; any other readable buffer wins, on its own revision, so a server copy changed meanwhile meets
 * the first save as a 409 and the prompt. An unreadable buffer is dropped.
 * @param {Storage} storage
 * @param {number} zineId
 * @param {{doc: any, revision: number}} loaded
 * @returns {{doc: any, revision: number, dirty: boolean}}
 */
export function recoverBuffer(storage, zineId, loaded) {
  const clean = { ...loaded, dirty: false };
  const key = bufferKey(zineId);
  try {
    const text = storage.getItem(key);
    if (text === null) return clean;
    const buffer = parse(text);
    const checked = buffer && Number.isInteger(buffer.revision) ? validateDog(buffer.doc) : { ok: false };
    if (!checked.ok || JSON.stringify(buffer.doc) === JSON.stringify(loaded.doc)) {
      storage.removeItem(key);
      return clean;
    }
    return { doc: checked.dog, revision: buffer.revision, dirty: true };
  } catch {
    return clean;
  }
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @param {{store: any, config: {zine_id: number, revision: number, csrf_token: string,
 *   routes: {save: string, load: string}}, env: Env, onState?: (s: SaveState) => void,
 *   onConflict?: (c: {revision: number}) => void, dirty?: boolean}} opts  `dirty`: the zine came from the buffer
 *   (recoverBuffer), so it is saved without waiting for an edit
 */
export function createAutosave({ store, config, env, onState = () => {}, onConflict = () => {}, dirty: recovered = false }) {
  const key = bufferKey(config.zine_id);
  let dirty = false;
  let conflict = false;
  let stopped = false;
  /** @type {Promise<void>|null} */
  let inFlight = null;
  let timer = null;
  let retry = RETRY_MS;
  /** The text last sent by beacon on the current revision: if it landed, a 409 shows exactly this copy. */
  let beaconed = null;

  const storage = (fn) => {
    try {
      fn(env.storage);
    } catch {
      // Private mode or a full quota: saving still works, only the reload safety net is gone.
    }
  };
  const writeBuffer = () => storage((s) => s.setItem(key, JSON.stringify({ revision: config.revision, doc: store.doc })));
  const dropBuffer = () => storage((s) => s.removeItem(key));
  const schedule = (ms) => {
    env.clearTimeout(timer);
    timer = env.setTimeout(() => { timer = null; flush(); }, ms);
  };
  const form = (text) => {
    const body = new FormData();
    body.append('csrf_token', config.csrf_token);
    body.append('revision', String(config.revision));
    body.append('document', text);
    return body;
  };

  const onChange = () => {
    if (stopped) return;
    dirty = true;
    writeBuffer();
    onState(conflict ? 'conflict' : 'dirty');
    if (!conflict) schedule(AUTOSAVE_DELAY_MS);
  };
  store.on('change', onChange);
  if (recovered) onChange();

  /** The server's copy as {revision, text}, or null when it cannot be read. */
  async function serverCopy() {
    try {
      const res = await env.fetch(config.routes.load, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const body = res.ok ? await res.json() : null;
      return body && Number.isInteger(body.revision) ? { revision: body.revision, text: JSON.stringify(body.document) } : null;
    } catch {
      return null;
    }
  }

  function acknowledged(revision) {
    config.revision = revision;
    beaconed = null;
    retry = RETRY_MS;
    if (dirty) {
      writeBuffer();
      schedule(AUTOSAVE_DELAY_MS);
      onState('dirty');
    } else {
      dropBuffer();
      onState('saved');
    }
  }

  async function send() {
    const text = JSON.stringify(store.doc);
    dirty = false;
    onState('saving');
    try {
      const res = await env.fetch(config.routes.save, { method: 'POST', body: form(text), credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok === true && Number.isInteger(body.revision)) return acknowledged(body.revision);
      if (res.status === 409 && Number.isInteger(body?.revision)) {
        // Not a conflict when the newer server copy is this tab's own: this very text (an earlier request landed),
        // or the copy it beaconed when the tab was hidden (then this one goes again on top of it).
        const copy = await serverCopy();
        if (copy?.text === text) return acknowledged(copy.revision);
        dirty = true;
        if (beaconed !== null && copy?.text === beaconed) {
          config.revision = copy.revision;
          beaconed = null;
          return send();
        }
        conflict = true;
        writeBuffer();
        onState('conflict');
        onConflict({ revision: body.revision });
        return;
      }
      throw new Error(`save: HTTP ${res.status}`);
    } catch {
      dirty = true;
      writeBuffer();
      onState('error');
      schedule(retry);
      retry = Math.min(RETRY_MAX_MS, retry * 2);
    }
  }

  /** Saves now if anything is unsaved; one request at a time, the next one follows the first. */
  async function flush() {
    if (stopped || conflict) return;
    if (inFlight) return inFlight;
    if (!dirty) return;
    env.clearTimeout(timer);
    inFlight = send().finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    get dirty() { return dirty; },
    flush,

    /** The tab is hidden or going away: send unsaved edits with a beacon, once per copy. */
    pagehide() {
      if (stopped || conflict || !dirty) return;
      const text = JSON.stringify(store.doc);
      if (text === beaconed) return;
      writeBuffer();
      beaconed = env.sendBeacon(config.routes.save, form(text)) ? text : null;
    },

    /** "Keep mine" in the conflict prompt: save this tab's zine over the server's revision. */
    keepMine(revision) {
      conflict = false;
      config.revision = revision;
      dirty = true;
      writeBuffer();
      return flush();
    },

    /** "Reload" in the conflict prompt: forget this tab's edits and stop saving. */
    discard() {
      stopped = true;
      env.clearTimeout(timer);
      store.off('change', onChange);
      dropBuffer();
    },
  };
}
