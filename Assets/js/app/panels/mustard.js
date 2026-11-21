// "Write in Mustard": the zine as Mustard text (exportMustard). Apply compiles it; with no errors the pages are
// replaced (hand-made and locked items stay, applyMustard) and warnings are listed; errors are listed and nothing
// changes. "Import Mustard file" loads a .mustard.md into the text and applies it the same way; "Download Mustard"
// saves the zine as one. Viewers read the text and may download it.
import { downloadBlob, h } from '../dom.js?v=0.1.0';
import { mustardFile, readMustardFile } from '../mustard-file.js?v=0.1.0';
import { compileMustard, exportMustard } from '../../core/mustard.js?v=0.1.0';
import { applyMustard } from '../edit.js?v=0.1.0';

/** @param {any} app */
export function createMustardPanel(app) {
  const { store, strings } = app;
  const text = /** @type {HTMLTextAreaElement} */ (h('textarea', {
    class: 'hdp-mustard-text', spellcheck: 'false', readonly: !app.canEdit, 'aria-label': strings.mustard,
  }));
  const notes = h('div', { class: 'hdp-mustard-notes', 'aria-live': 'polite' });
  const apply = h('button', { type: 'button', class: 'btn btn-blue', onclick: () => run() }, strings.mustard_apply);
  const picker = /** @type {HTMLInputElement} */ (h('input', {
    type: 'file', accept: '.md,.markdown,text/markdown,text/plain', hidden: true, onchange: () => importFile(),
  }));
  const importButton = h('button', {
    type: 'button', class: 'btn', dataset: { mustard: 'import' }, onclick: () => picker.click(),
  }, strings.mustard_import);
  const downloadButton = h('button', {
    type: 'button', class: 'btn', dataset: { mustard: 'download' },
    onclick: () => { const f = mustardFile(store.doc); downloadBlob(new Blob([f.data], { type: f.type }), f.name); },
  }, strings.mustard_download);
  const close = h('button', { type: 'button', class: 'btn', onclick: () => app.toggleMustard(false) }, strings.close);
  const el = h('aside', { class: 'hdp-mustard', hidden: true, 'aria-label': strings.mustard },
    h('div', { class: 'hdp-mustard-head' }, h('h3', {}, strings.mustard), close),
    text, h('div', { class: 'hdp-mustard-actions' }, ...(app.canEdit ? [apply, importButton, picker] : []), downloadButton),
    notes);
  /** The text was typed in since it was last filled from the zine, so zine changes do not overwrite it. */
  let dirty = false;
  text.addEventListener('input', () => { dirty = true; });

  function fill() {
    text.value = exportMustard(store.doc).text;
    dirty = false;
  }

  function list(title, problems, kind) {
    const items = problems.map((p) => h('li', {}, p.line ? `${app.fill(strings.line_n, p.line)}: ${p.message}` : p.message));
    return h('div', { class: `hdp-note hdp-note-${kind}` }, title ? h('p', {}, title) : null, items.length ? h('ul', {}, ...items) : null);
  }

  async function importFile() {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    const read = await readMustardFile(file);
    if ('error' in read) {
      notes.replaceChildren(list(strings.mustard_errors, [read.error], 'error'));
      return;
    }
    text.value = read.text;
    dirty = true;
    run();
  }

  function run() {
    const doc = store.doc;
    const result = compileMustard(text.value, { paper: doc.paper, assets: doc.assets, from: doc });
    if (result.errors.length) {
      notes.replaceChildren(list(strings.mustard_errors, result.errors, 'error'));
      return;
    }
    store.update((d) => applyMustard(d, result.dog));
    fill();
    notes.replaceChildren(list(strings.mustard_applied, [], 'ok'),
      ...(result.warnings.length ? [list(strings.mustard_warnings, result.warnings, 'warning')] : []));
  }

  return {
    el,
    /** Shows or hides the panel; opening fills it from the zine. */
    show(open) {
      el.hidden = !open;
      if (open) {
        fill();
        notes.replaceChildren();
      }
    },
    /** The zine changed: refresh the text unless it is being typed in. */
    sync() {
      if (!el.hidden && !dirty && document.activeElement !== text) fill();
    },
  };
}
