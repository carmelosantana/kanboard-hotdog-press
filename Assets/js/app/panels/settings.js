// Zine settings: paper, margin, look, the current page's layout and the safe-area overlay. A <details> block that is
// open on wide screens and folded away on a phone. Viewers see the values, disabled.
import { h } from '../dom.js';
import { applyLayout, setMargin } from '../edit.js';
import { LAYOUT_NAMES, PAPER_IDS } from '../../core/dog.js';
import { LOOKS } from '../../core/looks.js';
import { MAX_MARGIN_MM } from '../../core/paper.js';

/** @param {any} app */
export function createSettings(app) {
  const { store, strings } = app;
  const disabled = !app.canEdit;
  const select = (name, values, labelOf, onchange) => {
    const el = h('select', { name, disabled, onchange: (e) => onchange(e.target.value) },
      ...values.map((v) => h('option', { value: v }, labelOf(v))));
    return el;
  };
  const field = (label, control) => h('label', { class: 'hdp-field' }, h('span', {}, label), control);

  const paper = select('paper', PAPER_IDS, (v) => strings[`paper_${v}`] ?? v, (v) => store.update((d) => ({ ...d, paper: v })));
  const margin = h('input', {
    type: 'number', name: 'margin_mm', min: 0, max: MAX_MARGIN_MM, step: 0.5, inputmode: 'decimal', disabled,
    onchange: (e) => store.update((d) => setMargin(d, Number(e.target.value))),
  });
  const look = select('look', Object.keys(LOOKS), (v) => strings[`look_${v}`] ?? v, (v) => store.update((d) => ({ ...d, look: v })));
  const layout = select('layout', LAYOUT_NAMES, (v) => strings[`layout_${v}`] ?? v,
    (v) => store.update((d) => applyLayout(d, store.page, v)));
  const safe = h('input', {
    type: 'checkbox', name: 'safe_area',
    onchange: (e) => { app.ui.safeArea = e.target.checked; app.render(); },
  });

  const wide = window.matchMedia('(min-width: 768px)').matches;
  const el = h('details', { class: 'hdp-settings', open: wide },
    h('summary', {}, strings.settings),
    h('div', { class: 'hdp-fields' },
      field(strings.paper, paper), field(strings.margin, margin), field(strings.look, look),
      field(strings.layout, layout),
      h('label', { class: 'hdp-field hdp-check' }, safe, h('span', {}, strings.safe_area))));

  function sync() {
    const d = store.doc;
    paper.value = d.paper;
    if (document.activeElement !== margin) margin.value = String(d.margin_mm);
    look.value = LOOKS[d.look] ? d.look : 'kraft';
    layout.value = d.pages[store.page].layout;
    layout.previousElementSibling.textContent = `${strings.layout} · ${app.fill(strings.page_n, store.page + 1)}`;
    safe.checked = app.ui.safeArea;
  }
  return { el, sync };
}
