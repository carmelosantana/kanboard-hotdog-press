// Autosave in the page: the autosave client on the browser's fetch, sessionStorage, sendBeacon and timers; a small
// save-state line; pagehide and hidden-tab flushes; and the "Someone else changed this zine" prompt (Reload / Keep
// mine). Members only: viewers never save.
import { h } from './dom.js?v=0.1.2';
import { createAutosave } from './autosave.js?v=0.1.2';

/** window.sessionStorage, or a stand-in that keeps nothing when the browser refuses it (blocked storage). */
export function sessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}

/**
 * @param {any} app the mounted editor
 * @param {{dirty?: boolean}} [opts] `dirty`: the zine came from this tab's buffer and is not saved yet
 * @returns {{el: HTMLElement, autosave: ReturnType<typeof createAutosave>}}
 */
export function startSaving(app, { dirty = false } = {}) {
  const { strings } = app;
  const line = h('span', { class: 'hdp-save-state', role: 'status', 'aria-live': 'polite' });
  let conflictRevision = 0;
  const reload = h('button', { type: 'button', class: 'btn', onclick: () => { autosave.discard(); location.reload(); } },
    strings.conflict_reload);
  const keep = h('button', {
    type: 'button', class: 'btn btn-blue', onclick: () => { dialog.close(); autosave.keepMine(conflictRevision); },
  }, strings.conflict_keep);
  const dialog = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'hdp-dialog', 'aria-labelledby': 'hdp-conflict-title' },
    h('h3', { id: 'hdp-conflict-title' }, strings.conflict_title),
    h('p', {}, strings.conflict_body),
    h('div', { class: 'hdp-dialog-actions' }, reload, keep)));
  // Escape would leave the editor unsaved with no way back to the choice; the prompt stays until one is picked.
  dialog.addEventListener('cancel', (e) => e.preventDefault());

  const text = { dirty: strings.saving, saving: strings.saving, saved: strings.saved, error: strings.save_failed, conflict: strings.conflict_title,
    stopped: strings.save_stopped };
  const autosave = createAutosave({
    store: app.store,
    config: app.config,
    env: {
      fetch: (...a) => fetch(...a),
      storage: sessionStore(),
      sendBeacon: (url, body) => navigator.sendBeacon(url, body),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    },
    dirty,
    onState: (s) => {
      line.textContent = text[s];
      line.dataset.state = s;
    },
    onConflict: ({ revision }) => {
      conflictRevision = revision;
      if (!dialog.open) dialog.showModal();
    },
  });

  window.addEventListener('pagehide', () => autosave.pagehide());
  // A phone may never fire pagehide for a tab it closes in the background: hidden is the last reliable moment.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosave.pagehide(); });
  return { el: h('div', { class: 'hdp-saving' }, line, dialog), autosave };
}
