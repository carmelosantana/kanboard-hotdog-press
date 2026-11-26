// Mounts the editor into the app root: toolbar, options row, settings, the active view, the Mustard panel and the page
// strip, all reading one store. Redraws are batched to one per animation frame.
import { createStore } from './store.js?v=0.1.2';
import { createImages } from './images.js?v=0.1.2';
import { fill } from './config.js?v=0.1.2';
import { h } from './dom.js?v=0.1.2';
import { addAsset, addItem, findItem, imageItem, removeItems, updateItem } from './edit.js?v=0.1.2';
import { uploadPhoto, PhotoError } from './photo.js?v=0.1.2';
import { randomId } from '../core/dog.js?v=0.1.2';
import { panelSize } from '../core/paper.js?v=0.1.2';
import { createPagesView } from './views/pages.js?v=0.1.2';
import { createSheetView } from './views/sheet.js?v=0.1.2';
import { createBookletView } from './views/booklet.js?v=0.1.2';
import { createToolbar } from './panels/toolbar.js?v=0.1.2';
import { createSettings } from './panels/settings.js?v=0.1.2';
import { createProps } from './panels/props.js?v=0.1.2';
import { createStrip } from './panels/strip.js?v=0.1.2';
import { createMustardPanel } from './panels/mustard.js?v=0.1.2';
import { createExportPanel } from './panels/export.js?v=0.1.2';
import { startSaving } from './saving.js?v=0.1.2';
import { selectTool } from './tools/select.js?v=0.1.2';
import { textTool } from './tools/text.js?v=0.1.2';
import { shapeTool } from './tools/shape.js?v=0.1.2';
import { inkTool } from './tools/ink.js?v=0.1.2';

const CANVAS_TOOLS = { select: selectTool, text: textTool, shape: shapeTool, ink: inkTool };
const FONT_PROBES = ['20px "Anton"', '20px "Courier Prime"', '20px "Atkinson Hyperlegible"'];

/**
 * @param {HTMLElement} root
 * @param {import('./config.js').EditorConfig} config
 * @param {any} dog the loaded Dog
 * @param {{dirty?: boolean}} [opts] `dirty`: the Dog came from this tab's unsaved buffer
 */
export function mountEditor(root, config, dog, { dirty = false } = {}) {
  const strings = config.strings;
  const store = createStore(dog);
  let frame = 0;
  const app = {
    config,
    strings,
    store,
    canEdit: config.can_edit === true,
    fill,
    ui: { view: 'pages', tool: 'select', shapeKind: 'rect', inkColor: 'toner', safeArea: false, mustard: false },
    images: /** @type {any} */ (null),
    /** The autosave client (members only), set once mounted. */
    autosave: /** @type {any} */ (null),
    /** Settles once the bundled fonts are loaded (or failed): exports wait for it, so no file bakes in a fallback face. */
    fontsReady: /** @type {Promise<void>} */ (Promise.resolve()),
    tool: () => CANVAS_TOOLS[app.ui.tool] ?? selectTool,
    render() {
      if (!frame) frame = requestAnimationFrame(draw);
    },
    setView(v) {
      pages.closeEditor();
      app.ui.view = v;
      layout();
    },
    setTool(t) {
      app.ui.tool = t;
      syncChrome();
    },
    pickTool(t) {
      if (t === 'photo') {
        fileInput.click();
        return;
      }
      app.setTool(t);
      if (app.ui.view !== 'pages') app.setView('pages');
    },
    toggleMustard(open = !app.ui.mustard) {
      app.ui.mustard = open;
      mustard.show(open);
      main.classList.toggle('has-panel', open);
      layout();
    },
    /** A message in the status line (polite live region); errors stay until the next message. */
    status(message, kind = 'info') {
      statusLine.textContent = message;
      statusLine.dataset.kind = kind;
    },
  };
  app.images = createImages(config, () => app.render());

  const toolbar = createToolbar(app);
  const props = createProps(app);
  const settings = createSettings(app);
  const exportPanel = createExportPanel(app);
  const pages = createPagesView(app);
  const views = { pages, sheet: createSheetView(app), booklet: createBookletView(app) };
  const mustard = createMustardPanel(app);
  const strip = createStrip(app);
  const stage = h('div', { class: 'hdp-stage' }, ...Object.values(views).map((v) => v.el));
  const main = h('div', { class: 'hdp-main' }, stage, mustard.el);
  const statusLine = h('p', { class: 'hdp-status', role: 'status', 'aria-live': 'polite' });
  const fileInput = /** @type {HTMLInputElement} */ (h('input', {
    type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'hdp-file', hidden: true,
    onchange: () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) addPhoto(file);
    },
  }));

  const saving = app.canEdit ? startSaving(app, { dirty }) : null;
  app.autosave = saving?.autosave ?? null;
  root.replaceChildren(...[
    toolbar.el, saving?.el ?? null, props.el, settings.el, exportPanel.el,
    app.canEdit ? null : h('p', { class: 'hdp-read-only' }, strings.read_only),
    main, strip.el, statusLine, fileInput,
  ].filter((n) => n !== null));
  root.classList.toggle('is-read-only', !app.canEdit);

  async function addPhoto(file) {
    app.status(strings.uploading);
    try {
      const up = await uploadPhoto(file, config);
      const id = `photo_${randomId()}`;
      const asset = { kind: 'image', file_id: up.file_id, w: up.w, h: up.h, name: up.name };
      app.images.put(id, asset, up.bitmap);
      const sel = store.selection.length === 1 ? findItem(store.doc, store.selection[0]) : null;
      const { w, h: ph } = panelSize(store.doc.paper);
      if (sel && sel.item.type === 'image' && sel.item.locked !== true) {
        store.update((d) => updateItem(addAsset(d, id, asset), sel.item.id, { asset: id, by: 'hand' }));
      } else {
        const item = imageItem(id, up.w, up.h, w / ph);
        store.update((d) => addItem(addAsset(d, id, asset), store.page, item));
        store.select([item.id]);
      }
      app.status('');
    } catch (err) {
      console.warn('Hot Dog Press: photo upload failed', err);
      app.status(strings[err instanceof PhotoError ? err.key : 'upload_failed'], 'error');
    }
  }

  function syncChrome() {
    toolbar.sync();
    props.sync();
    settings.sync();
    exportPanel.sync();
    strip.sync();
    root.dataset.tool = app.ui.tool;
    root.dataset.view = app.ui.view;
  }

  function layout() {
    for (const [name, v] of Object.entries(views)) v.el.hidden = name !== app.ui.view;
    const maxW = Math.max(120, stage.clientWidth);
    const maxH = Math.max(240, Math.min(window.innerHeight * 0.72, 900));
    views[app.ui.view].layout(maxW, maxH);
    syncChrome();
    app.render();
  }

  function draw() {
    frame = 0;
    app.images.sync(store.doc);
    views[app.ui.view].render();
    strip.render();
  }

  store.on('change', () => {
    mustard.sync();
    // Paper changes the page shape; everything else only needs a redraw.
    layout();
  });
  store.on('select', () => { syncChrome(); app.render(); });
  store.on('page', () => { syncChrome(); app.render(); });

  document.addEventListener('keydown', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo(); else store.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
    } else if (app.canEdit && (e.key === 'Delete' || e.key === 'Backspace') && store.selection.length) {
      e.preventDefault();
      store.update((d) => removeItems(d, store.selection));
    } else if (e.key === 'Escape') {
      store.select([]);
    }
  });

  new ResizeObserver(() => layout()).observe(stage);
  // Draw again once the bundled fonts are in, so text measures and renders in its real face.
  app.fontsReady = Promise.all(FONT_PROBES.map((f) => document.fonts.load(f))).then(() => {}, () => {});
  app.fontsReady.finally(() => app.render());
  document.fonts.addEventListener?.('loadingdone', () => app.render());

  layout();
  root.dataset.ready = 'true';
  return app;
}
