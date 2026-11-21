// Export: the print PDF (guides on or off, black and white), "Save PDF to project files" (members), and the social
// files (carousel ZIP at 3:4 or 4:5, cover, pin, story, sheet shot, Bluesky set, LinkedIn PDF). A file is downloaded
// through an <a download> with a blob: href (never a blob: <img>); where the browser can share files (phones) it is
// offered to the share sheet as well. Viewers may export; only members save to the project.
import { h } from '../dom.js?v=0.1.0';
import { linkedInFile, printName, printPdf, socialFiles } from '../exports.js?v=0.1.0';

const SOCIAL = [
  ['cover', 'cover_image'], ['pin', 'pin'], ['story', 'story'], ['sheet', 'sheet_image'], ['bluesky', 'bluesky'],
];

/** @param {any} app */
export function createExportPanel(app) {
  const { store, strings, config } = app;
  const check = (name, checked, label) => {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', name, checked }));
    return [input, h('label', { class: 'hdp-field hdp-check' }, input, h('span', {}, label))];
  };
  const [guides, guidesField] = check('export_guides', true, strings.guides);
  const [bw, bwField] = check('export_bw', false, strings.bw);
  const ratio = /** @type {HTMLSelectElement} */ (h('select', { name: 'carousel_ratio', 'aria-label': strings.carousel_size },
    h('option', { value: 'carousel-3x4' }, strings.carousel_3x4), h('option', { value: 'carousel-4x5' }, strings.carousel_4x5)));
  const note = h('p', { class: 'hdp-print-note' });
  const ready = h('div', { class: 'hdp-export-ready', hidden: true });
  const button = (label, job, extra = {}) => h('button', { type: 'button', class: 'btn', onclick: () => run(job), ...extra }, label);

  const buttons = [
    button(strings.export_pdf, makePdf, { class: 'btn btn-blue', dataset: { export: 'pdf' } }),
    app.canEdit ? button(strings.save_pdf_to_files, savePdf, { dataset: { export: 'save-pdf' } }) : null,
    button(strings.carousel, () => social(ratio.value), { dataset: { export: 'carousel' } }),
    ...SOCIAL.map(([id, key]) => button(strings[key], () => social(id), { dataset: { export: id } })),
    button(strings.linkedin_pdf, () => linkedInFile(store.doc, app.images.map, opts()), { dataset: { export: 'linkedin' } }),
  ];
  const [pdfButton, saveButton, carouselButton, ...socialButtons] = buttons;

  const el = h('details', { class: 'hdp-export' },
    h('summary', {}, strings.export),
    h('div', { class: 'hdp-export-body' },
      h('div', { class: 'hdp-export-group' },
        h('h4', {}, strings.print), h('div', { class: 'hdp-fields' }, guidesField, bwField),
        h('div', { class: 'hdp-group hdp-wrap' }, pdfButton, saveButton), note),
      h('div', { class: 'hdp-export-group' },
        h('h4', {}, strings.social),
        h('div', { class: 'hdp-group hdp-wrap' }, carouselButton, ratio, ...socialButtons)),
      ready));

  const opts = () => ({ bw: bw.checked });
  const printNote = () => app.fill(strings.print_note, strings[`paper_${store.doc.paper}`] ?? store.doc.paper);

  async function makePdf() {
    return { name: printName(store.doc), type: 'application/pdf', data: await printPdf(store.doc, app.images.map, { ...opts(), guides: guides.checked }) };
  }

  function social(presetId) {
    return socialFiles(store.doc, presetId, app.images.map, {
      ...opts(), ...(presetId === 'story' ? { caption: strings.story_caption } : {}),
    });
  }

  async function savePdf() {
    // The server names the file from its copy of the zine: bring that copy up to date first.
    await app.autosave?.saved();
    const file = await makePdf();
    const body = new FormData();
    body.append('csrf_token', config.csrf_token);
    body.append('pdf', new Blob([file.data], { type: file.type }), file.name);
    const res = await fetch(config.routes.pdf, { method: 'POST', body, credentials: 'same-origin' });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.ok !== true) throw Object.assign(new Error(`save pdf: HTTP ${res.status}`), { key: 'pdf_save_failed' });
    app.status(app.fill(strings.pdf_saved, json.name));
    return null;
  }

  /** Makes a file (all images loaded first), then downloads it or offers Download and Share. */
  async function run(job) {
    for (const b of buttons) if (b) b.disabled = true;
    ready.hidden = true;
    app.status(strings.export_working);
    try {
      await app.images.settled(store.doc);
      const file = await job();
      if (file) deliver(file);
    } catch (err) {
      console.warn('Hot Dog Press: export failed', err);
      app.status(strings[err?.key] ?? strings.export_failed, 'error');
    } finally {
      for (const b of buttons) if (b) b.disabled = false;
    }
  }

  function deliver(file) {
    const blob = new Blob([file.data], { type: file.type });
    const done = file.type === 'application/pdf' && file.name === printName(store.doc)
      ? `${strings.export_flavour} · ${printNote()}` : strings.export_flavour;
    const shared = new File([blob], file.name, { type: file.type });
    if (navigator.canShare?.({ files: [shared] })) {
      // Sharing needs a fresh tap: making the file may have used up the first one.
      ready.replaceChildren(h('span', {}, file.name),
        h('button', { type: 'button', class: 'btn', onclick: () => download(blob, file.name) }, strings.download),
        h('button', {
          type: 'button', class: 'btn btn-blue',
          onclick: () => navigator.share({ files: [shared] }).catch(() => {}),
        }, strings.share));
      ready.hidden = false;
    } else {
      download(blob, file.name);
    }
    app.status(done);
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  return {
    el,
    sync() {
      note.textContent = printNote();
    },
  };
}
