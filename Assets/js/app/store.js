// The editor's one document store: the Dog as frozen snapshots, undo/redo, change events, the selection and the
// current page. Everything that changes the zine goes through update(), so autosave and exports (Task 12) only need
// to listen for 'change'. No DOM.

/** Undo steps kept (the brief asks for at least 50). */
export const HISTORY_LIMIT = 100;

/**
 * @typedef {'change'|'select'|'page'} StoreEvent
 * @typedef {{doc: any, reason: 'edit'|'undo'|'redo'|'replace'}} ChangeEvent
 */

/**
 * @param {any} doc the loaded Dog
 */
export function createStore(doc) {
  let current = deepFreeze(doc);
  /** @type {any[]} */
  let past = [];
  /** @type {any[]} */
  let future = [];
  /** @type {string|null} */
  let lastMerge = null;
  /** @type {string[]} */
  let selection = [];
  let page = 0;
  /** @type {Record<string, Set<Function>>} */
  const listeners = { change: new Set(), select: new Set(), page: new Set() };
  const emit = (name, payload) => { for (const fn of [...listeners[name]]) fn(payload); };

  const setDoc = (next, reason) => {
    current = next;
    emit('change', { doc: current, reason });
    const ids = itemIds(current);
    const kept = selection.filter((id) => ids.has(id));
    if (kept.length !== selection.length) store.select(kept);
  };

  const store = {
    get doc() { return current; },
    get selection() { return selection; },
    get page() { return page; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },

    /**
     * Replace the document with `fn(doc)`. Edits sharing a `merge` key in a row are one undo step.
     * @param {(doc: any) => any} fn returns the next document (or the same one for no change)
     * @param {{merge?: string}} [opts]
     */
    update(fn, { merge } = {}) {
      const next = fn(current);
      if (next === current || next === undefined) return;
      if (!(merge && merge === lastMerge)) {
        past.push(current);
        if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT);
      }
      future = [];
      lastMerge = merge ?? null;
      setDoc(deepFreeze(next), 'edit');
    },

    undo() {
      if (!past.length) return;
      future.push(current);
      lastMerge = null;
      setDoc(past.pop(), 'undo');
    },

    redo() {
      if (!future.length) return;
      past.push(current);
      lastMerge = null;
      setDoc(future.pop(), 'redo');
    },

    /** A new document with no history (first load, reload after a conflict). */
    replace(next) {
      past = [];
      future = [];
      lastMerge = null;
      setDoc(deepFreeze(next), 'replace');
    },

    /** @param {string[]} ids */
    select(ids) {
      selection = Object.freeze([...ids]);
      emit('select', { selection });
    },

    /** @param {number} index 0..7, clamped */
    setPage(index) {
      page = Math.min(7, Math.max(0, Math.trunc(index) || 0));
      emit('page', { page });
    },

    /** @param {StoreEvent} name @param {Function} fn */
    on(name, fn) { listeners[name].add(fn); },
    /** @param {StoreEvent} name @param {Function} fn */
    off(name, fn) { listeners[name].delete(fn); },

    /** Ends a merge run, so the next edit is its own undo step. */
    seal() { lastMerge = null; },
  };
  return store;
}

function itemIds(doc) {
  const ids = new Set();
  for (const p of doc.pages ?? []) for (const it of p.items ?? []) ids.add(it.id);
  return ids;
}

/** Freezes every object reachable from `value` that is not frozen yet (shared, already-frozen parts are skipped). */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const v of Object.values(value)) deepFreeze(v);
  return value;
}
