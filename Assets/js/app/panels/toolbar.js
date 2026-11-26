// The toolbar: view tabs, the tools (members only), undo/redo, delete, lock and the Mustard panel toggle. On a phone
// it is one row that scrolls sideways.
import { h } from '../dom.js?v=0.1.2';
import { removeItems, toggleLock, findItem } from '../edit.js?v=0.1.2';

const TOOLS = ['select', 'text', 'photo', 'shape', 'sticker', 'ink'];
const VIEWS = ['pages', 'sheet', 'booklet'];

/** @param {any} app */
export function createToolbar(app) {
  const { store, strings } = app;
  const viewButtons = VIEWS.map((v) => h('button', {
    type: 'button', role: 'tab', class: 'hdp-tab', dataset: { view: v }, onclick: () => app.setView(v),
  }, strings[`view_${v}`]));
  const views = h('div', { class: 'hdp-group hdp-views', role: 'tablist' }, ...viewButtons);

  const toolButtons = TOOLS.map((t) => h('button', {
    type: 'button', class: 'btn hdp-tool', dataset: { tool: t }, onclick: () => app.pickTool(t),
  }, strings[`tool_${t}`]));
  const undo = h('button', { type: 'button', class: 'btn', onclick: () => store.undo() }, strings.undo);
  const redo = h('button', { type: 'button', class: 'btn', onclick: () => store.redo() }, strings.redo);
  const del = h('button', {
    type: 'button', class: 'btn hdp-danger', onclick: () => store.update((d) => removeItems(d, store.selection)),
  }, strings.delete);
  const lock = h('button', { type: 'button', class: 'btn', onclick: () => store.update((d) => toggleLock(d, store.selection)) }, strings.lock);
  const mustard = h('button', {
    type: 'button', class: 'btn hdp-mustard-toggle', 'aria-expanded': 'false', onclick: () => app.toggleMustard(),
  }, strings.mustard);

  const el = h('div', { class: 'hdp-toolbar', role: 'toolbar' }, views,
    app.canEdit ? h('div', { class: 'hdp-group hdp-tools' }, ...toolButtons) : null,
    app.canEdit ? h('div', { class: 'hdp-group' }, undo, redo, del, lock) : null,
    h('div', { class: 'hdp-group' }, mustard));

  function sync() {
    for (const b of viewButtons) b.setAttribute('aria-selected', String(b.dataset.view === app.ui.view));
    for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.tool === app.ui.tool));
    const selected = store.selection.map((id) => findItem(store.doc, id)?.item).filter(Boolean);
    undo.disabled = !store.canUndo;
    redo.disabled = !store.canRedo;
    del.disabled = !selected.some((it) => it.locked !== true);
    lock.disabled = selected.length === 0;
    lock.textContent = selected.length && selected.every((it) => it.locked === true) ? strings.unlock : strings.lock;
    mustard.setAttribute('aria-expanded', String(app.ui.mustard));
  }
  return { el, sync };
}
