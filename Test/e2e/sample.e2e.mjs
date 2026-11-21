// The Plant Medicine sample (Task 13) on the :8081 dev stack, headless Chromium via Playwright from the harness
// root's node_modules. Repeatable: each run seeds (idempotent), clears the sample project's zines and makes them again.
//
//   seed "Plant Medicine (sample)" twice (the second run changes nothing) → zine A "Cohoba and the questions we ask":
//   the Plant Medicine Mustard fixture pasted into Write-in-Mustard and applied, its two photo slots (no photos)
//   replaced by hand-drawn ink → zine B "Preguntas al patio" by hand on the copy-shop look: text boxes, a shape, a
//   sticker and ink → on the sample project: a reload mid-edit keeps the edit, two tabs bring up the 409 prompt, the
//   viewer opens zine A read-only and the server refuses the viewer's save (403) → the exports, each checked (PDF page
//   size in points, PNG and ZIP frame sizes) and a PNG preview of page 1 of each PDF.
// Every page must log no console error, no page error and no CSP violation, and request nothing from another origin.
// The zines stay on :8081 to look at; the files go to the output dir (default: the harness reports/hotdogpress-p1/).
// Run from the harness root: node HotDogPress/Test/e2e/sample.e2e.mjs [out-dir]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import {
  BASE, PLUGIN, php, problems, watch, CSP_PROBE, cspCheck, login, state, items, until, serverCopy, createZine,
  removeZine, addText, texts, untilSaved, download, pngSize, latin1,
} from './lib.mjs';
import { readZip } from '../js/helpers/zip-reader.mjs';
import { seedPlantMedicine, VIEWER, VIEWER_PASSWORD_DEFAULT } from '../tools/seed-plant-medicine.mjs';

const OUT = resolve(process.argv[2] || join(PLUGIN, '../reports/hotdogpress-p1'));
mkdirSync(OUT, { recursive: true });
const MUSTARD = readFileSync(join(PLUGIN, 'Test/fixtures/mustard/plant-medicine.mustard.md'), 'utf8');
const MM_PT = 72 / 25.4;
const PAPER_PT = { letter: [279.4 * MM_PT, 215.9 * MM_PT], a4: [297 * MM_PT, 210 * MM_PT] };
const conflict409 = (r) => r.status() === 409 && /\/save$/.test(new URL(r.url()).pathname);
const viewer403 = (r) => r.status() === 403 && /\/save$/.test(new URL(r.url()).pathname);
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
/** What the report lists: file → measured size. */
const manifest = {};

async function overlayBox(page) {
  const b = await page.locator('.hdp-overlay').boundingBox();
  assert.ok(b && b.width > 50, 'the page canvas is laid out');
  return { ...b, at: (fx, fy) => ({ x: b.x + fx * b.width, y: b.y + fy * b.height }) };
}
const goPage = (page, n) => page.locator('.hdp-thumb').nth(n - 1).click();

/** Draws one ink stroke through panel points [[fx, fy], …] in a colour token. */
async function ink(page, points, color = 'Ink') {
  await page.click('[data-tool="ink"]');
  await page.click(`.hdp-props .hdp-swatch[aria-label="${color}"]`);
  const box = await overlayBox(page);
  const [first, ...rest] = points.map(([x, y]) => box.at(x, y));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.up();
  await page.click('[data-tool="select"]');
}
/** A leaf: an almond outline, its midrib and a stem, centred at (cx, cy), `s` panel units tall. */
async function leaf(page, cx, cy, s, color = 'Relish') {
  const outline = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * 2 * Math.PI;
    outline.push([cx + Math.sin(t) * s * 0.28 * Math.abs(Math.sin(t / 2) + 0.15), cy - Math.cos(t) * s * 0.5]);
  }
  await ink(page, outline, color);
  await ink(page, [[cx, cy - s * 0.45], [cx + s * 0.02, cy], [cx, cy + s * 0.5], [cx - s * 0.06, cy + s * 0.7]], color);
}
/** Drags with the mouse from one page point to another (panel units). */
async function drag(page, [x0, y0], [x1, y1]) {
  const box = await overlayBox(page);
  await page.mouse.move(box.at(x0, y0).x, box.at(x0, y0).y);
  await page.mouse.down();
  await page.mouse.move(box.at(x1, y1).x, box.at(x1, y1).y, { steps: 10 });
  await page.mouse.up();
}
/** Selects an item by a tap at its centre. */
async function pick(page, it) {
  const box = await overlayBox(page);
  const c = box.at(it.x + it.w / 2, it.y + Math.min(it.h / 2, 0.03));
  await page.mouse.click(c.x, c.y);
  assert.deepEqual((await state(page)).selection, [it.id], `picked ${it.id}`);
}
const newest = async (page, type) => items(await state(page)).filter((i) => i.type === type).at(-1);
/** Picks an item and drags its bottom-right handle so the box is `h` tall (text past a box's bottom is not drawn). */
async function setHeight(page, it, h) {
  await pick(page, it);
  await drag(page, [it.x + it.w, it.y + it.h], [it.x + it.w, it.y + h]);
}
/** Picks the page's newest text box, sets its font, steps its size up `bigger` times and makes it `h` tall. */
async function styleText(page, font, bigger, h) {
  const t = await newest(page, 'text');
  await pick(page, t);
  await page.selectOption('.hdp-props select[aria-label="Font"]', font, { timeout: 5000 });
  for (let i = 0; i < bigger; i++) await page.click('.hdp-props button[aria-label="Bigger text"]');
  if (h) await setHeight(page, t, h);
}

/** A PDF's single page size in points, from its MediaBox. */
function pdfPage(bytes) {
  const text = latin1(bytes);
  assert.ok(text.startsWith('%PDF-'), 'a PDF');
  assert.equal((text.match(/\/Type \/Page\b/g) ?? []).length, 1, 'one page');
  const m = /\/MediaBox \[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(text);
  return [Number(m[1]), Number(m[2])];
}
/** Saves a PDF export, checks its page against the paper (landscape, within 1 pt) and renders page 1 as a PNG. */
async function savePdf(page, file, paper) {
  const { bytes } = await download(page, '[data-export="pdf"]');
  const [w, h] = pdfPage(bytes);
  const [pw, ph] = PAPER_PT[paper];
  assert.ok(Math.abs(w - pw) <= 1 && Math.abs(h - ph) <= 1, `${file}: ${w} × ${h} pt, expected ${pw.toFixed(2)} × ${ph.toFixed(2)}`);
  writeFileSync(join(OUT, file), bytes);
  const preview = file.replace(/\.pdf$/, '.page1.png');
  execFileSync('pdftoppm', ['-png', '-r', '60', '-singlefile', join(OUT, file), join(OUT, preview.replace(/\.png$/, ''))]);
  manifest[file] = `${w} × ${h} pt (${paper}, landscape), ${bytes.length} bytes`;
  manifest[preview] = `${pngSize(new Uint8Array(readFileSync(join(OUT, preview)))).join(' × ')} px preview`;
}
async function savePng(page, id, file, size) {
  const { bytes } = await download(page, `[data-export="${id}"]`);
  assert.deepEqual(pngSize(bytes), size, file);
  writeFileSync(join(OUT, file), bytes);
  manifest[file] = `${size.join(' × ')} px`;
}

const browser = await chromium.launch();
try {
  // ------------------------------------------------------------ seed (twice: the second run changes nothing)
  const seed = await seedPlantMedicine();
  const again = await seedPlantMedicine();
  assert.deepEqual(again, { ...seed, changes: [] }, 'a second seed run changes nothing');
  const PROJECT = seed.project_id;
  // Start clean: the sample project holds only the zines this run makes.
  const old = JSON.parse(php(`$q = $db->prepare("SELECT id FROM hotdogpress_zines WHERE project_id = ?"); $q->execute([$argv[1]]); echo json_encode($q->fetchAll(PDO::FETCH_COLUMN));`, String(PROJECT)));
  for (const id of old) removeZine(id, PROJECT);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, acceptDownloads: true });
  await ctx.addInitScript(CSP_PROBE);
  const page = await login(ctx, 'admin', 'admin');
  watch(page, 'admin', { expect: conflict409 });

  // ------------------------------------------------------------ zine A: the Mustard fixture, through the editor
  const zineA = await createZine(page, 'Cohoba and the questions we ask', PROJECT);
  await page.waitForFunction(() => document.fonts.check('20px "Anton"') && document.fonts.check('20px "Atkinson Hyperlegible"'));
  await page.click('.hdp-mustard-toggle');
  await page.fill('.hdp-mustard-text', MUSTARD);
  await page.click('.hdp-mustard button:has-text("Apply")');
  await page.waitForSelector('.hdp-note-ok');
  const warningsA = await page.locator('.hdp-note-warning li').allTextContents();
  await page.click('.hdp-mustard button:has-text("Close")');
  let s = await state(page);
  assert.equal(s.doc.title, 'Medicina de plantas en Puerto Rico');
  assert.equal(s.doc.paper, 'letter');
  assert.deepEqual(s.doc.pages.map((p) => p.layout),
    ['cover', 'headline-body', 'photo-caption', 'quote', 'headline-body', 'list', 'headline-body', 'back-cover']);
  // No photos: each photo slot's placeholder is deleted and a hand-drawn leaf goes in its place (no stock photos).
  for (const n of [1, 3]) {
    await goPage(page, n);
    s = await state(page);
    const photo = items(s).find((i) => i.type === 'image');
    assert.ok(photo, `page ${n} has a photo slot`);
    const box = await overlayBox(page);
    const c = box.at(photo.x + photo.w / 2, photo.y + photo.h / 2);
    await page.mouse.click(c.x, c.y);
    assert.deepEqual((await state(page)).selection, [photo.id]);
    await page.keyboard.press('Delete');
    await leaf(page, photo.x + photo.w / 2, photo.y + photo.h / 2, Math.min(photo.h * 0.8, 0.3));
    s = await state(page);
    assert.ok(!items(s).some((i) => i.type === 'image') && items(s).filter((i) => i.type === 'ink').length === 2, `page ${n}: ink, no photo`);
  }
  s = await untilSaved(page, 'zine A');
  // Nothing overflows: every text box of zine A holds all its lines in the real fonts, on Letter and on A4.
  const cut = await page.evaluate(async () => {
    const base = new URL(document.querySelector('script[data-main*="HotDogPress/Assets/js/app/main.js"]').dataset.main, document.baseURI).href;
    const m = await import(base);
    const { layoutText } = await import(new URL('../core/render.js' + new URL(base).search, base).href);
    const { panelSize } = await import(new URL('../core/paper.js' + new URL(base).search, base).href);
    const g = new OffscreenCanvas(10, 10).getContext('2d');
    const doc = m.editor.store.doc;
    const out = [];
    for (const paper of ['letter', 'a4']) {
      const { w, h } = panelSize(paper);
      doc.pages.forEach((p, n) => p.items.filter((i) => i.type === 'text').forEach((i) => {
        const l = layoutText(g, i, w * 10, h * 10, doc.look);
        if (l.overflow) out.push(`${paper} page ${n + 1} ${i.slot}: ${l.lines.slice(l.visible).join(' / ')}`);
      }));
    }
    return out;
  });
  assert.deepEqual(cut, [], 'no text in zine A runs past its box');
  assert.ok(!s.doc.pages.some((p) => p.items.some((i) => i.type === 'image')), 'no photo slot left in zine A');
  await goPage(page, 1);
  await shot(page, 'zine-a-editor');

  // ------------------------------------------------------------ zine A exports
  await page.click('.hdp-export summary');
  assert.equal(await page.locator('.hdp-print-note').textContent(), 'Print at Actual size (100%), on Letter, one side.');
  assert.ok(await page.isChecked('input[name=export_guides]') && !(await page.isChecked('input[name=export_bw]')));
  await savePdf(page, 'zine-a-letter.pdf', 'letter');
  const carousel = await download(page, '[data-export="carousel"]');
  const frames = readZip(carousel.bytes);
  assert.equal(frames.length, 8, 'carousel: 8 frames');
  for (const f of frames) assert.deepEqual(pngSize(f.data), [1080, 1440], f.name);
  writeFileSync(join(OUT, 'zine-a-carousel-3x4.zip'), carousel.bytes);
  manifest['zine-a-carousel-3x4.zip'] = `8 PNGs, each 1080 × 1440 px (${frames.map((f) => f.name).join(', ')})`;
  await savePng(page, 'cover', 'zine-a-cover.png', [1080, 1440]);
  await savePng(page, 'story', 'zine-a-story.png', [1080, 1920]);
  await savePng(page, 'sheet', 'zine-a-sheet.png', [2160, 1528]);
  await page.check('input[name=export_bw]');
  await savePdf(page, 'zine-a-letter-bw.pdf', 'letter');
  await page.uncheck('input[name=export_bw]');
  await page.selectOption('select[name=paper]', 'a4');
  assert.equal(await page.locator('.hdp-print-note').textContent(), 'Print at Actual size (100%), on A4, one side.');
  await savePdf(page, 'zine-a-a4.pdf', 'a4');
  await page.selectOption('select[name=paper]', 'letter');
  await untilSaved(page, 'zine A back on Letter');

  // ------------------------------------------------------------ the viewer: opens zine A, cannot save
  const vctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await vctx.addInitScript(CSP_PROBE);
  const vpage = await login(vctx, VIEWER, process.env.ZINE_VIEWER_PASSWORD || VIEWER_PASSWORD_DEFAULT);
  watch(vpage, 'viewer', { expect: viewer403, quiet: (t) => /status of 403/.test(t) });
  await vpage.goto(`${BASE}/hotdogpress/zine/${zineA}`);
  await vpage.waitForSelector('#hotdogpress-app[data-ready="true"]');
  assert.equal(await vpage.locator('.hdp-tool').count(), 0, 'no tools');
  assert.equal(await vpage.locator('.hdp-read-only').count(), 1, 'read-only note');
  assert.equal(await vpage.locator('[data-export="save-pdf"]').count(), 0, 'no Save PDF to project files');
  const before = await serverCopy(vpage);
  const status = await vpage.evaluate(async () => {
    const c = JSON.parse(document.getElementById('hotdogpress-config').textContent);
    const copy = await (await fetch(c.routes.load, { headers: { Accept: 'application/json' } })).json();
    const body = new FormData();
    body.append('csrf_token', c.csrf_token);
    body.append('revision', String(copy.revision));
    body.append('document', JSON.stringify({ ...copy.document, title: 'Viewer was here' }));
    return (await fetch(c.routes.save, { method: 'POST', body, credentials: 'same-origin' })).status;
  });
  assert.equal(status, 403, 'the server refuses a viewer save');
  assert.deepEqual(await serverCopy(vpage), before, 'zine A is unchanged');
  await shot(vpage, 'zine-a-viewer');
  await cspCheck(vpage, 'viewer');
  await vctx.close();

  // ------------------------------------------------------------ zine B: by hand, copy-shop look
  const zineB = await createZine(page, 'Preguntas al patio', PROJECT);
  await page.selectOption('select[name=look]', 'copy-shop');
  // Page 1, the cover: title, subtitle, a sticker and a hand-drawn sprig.
  await goPage(page, 1);
  await addText(page, 'Preguntas\nal patio', 0.12, 0.08);
  await styleText(page, 'display', 4, 0.34);
  await addText(page, 'Questions for the yard', 0.12, 0.44);
  await styleText(page, 'body', 1, 0.16);
  await page.click('[data-tool="sticker"]');
  await page.click('.hdp-sticker[aria-label="Star burst"]');
  await until(page, (x) => items(x, 0).some((i) => i.type === 'sticker'), 'the sticker');
  await page.click('[data-tool="select"]');
  const star = await newest(page, 'sticker');
  await pick(page, star);
  await drag(page, [star.x + star.w / 2, star.y + star.h / 2], [0.32, 0.76]);
  await leaf(page, 0.68, 0.74, 0.26);
  // Pages 2–6: one question each, Spanish first.
  const questions = [
    '¿Quién te lo enseñó?\nWho taught you?',
    '¿De dónde viene la planta?\nWhere does the plant come from?',
    '¿Quién da permiso?\nWho gives permission?',
    '¿De quién es esta historia?\nWhose story is this?',
    '¿Qué no sabemos todavía?\nWhat don’t we know yet?',
  ];
  for (const [i, q] of questions.entries()) {
    await goPage(page, i + 2);
    await addText(page, q, 0.12, 0.12);
    await styleText(page, 'display', 1, 0.36);
  }
  // Page 3 gets a shape: a mustard ellipse low on the page, like a pot of soil.
  await goPage(page, 3);
  await page.click('[data-tool="shape"]');
  await page.click('.hdp-props button:has-text("Ellipse")');
  await drag(page, [0.2, 0.66], [0.8, 0.84]);
  await page.click('[data-tool="select"]');
  await leaf(page, 0.5, 0.5, 0.22);
  // Page 7: write your own, on ruled ink lines.
  await goPage(page, 7);
  await addText(page, 'Tu pregunta:\nYour question:', 0.12, 0.12);
  await styleText(page, 'body', 1, 0.2);
  for (const y of [0.45, 0.6, 0.75]) await ink(page, [[0.12, y], [0.5, y + 0.004], [0.88, y]]);
  await untilSaved(page, 'zine B pages 1–7');

  // A reload mid-edit keeps the edit: page 8 is typed and the tab reloads inside the 2 s debounce.
  await goPage(page, 8);
  await addText(page, 'No es consejo médico.\nNot medical advice.', 0.12, 0.12);
  s = await state(page);
  assert.equal(s.saveState, 'dirty', 'reloading before the save');
  await page.reload();
  await page.waitForSelector('#hotdogpress-app[data-ready="true"]');
  assert.ok(texts((await state(page)).doc).includes('No es consejo médico.\nNot medical advice.'), 'the edit is back after the reload');
  await untilSaved(page, 'the edit made before the reload');
  await goPage(page, 8);
  await styleText(page, 'body', 1, 0.32);
  await untilSaved(page, 'page 8');

  // Two tabs: the stale one gets the 409 prompt; Keep mine saves over tab two's scrap edit.
  const page2 = await ctx.newPage();
  watch(page2, 'tab two', { expect: conflict409 });
  await page2.goto(page.url());
  await page2.waitForSelector('#hotdogpress-app[data-ready="true"]');
  await page2.locator('.hdp-thumb').nth(7).click();
  await addText(page2, 'Scrap from tab two', 0.12, 0.6);
  await untilSaved(page2, 'tab two');
  await page2.close();
  await goPage(page, 8);
  await addText(page, 'Hot Dog Press · muestra / sample', 0.12, 0.85);
  await page.waitForSelector('dialog.hdp-dialog[open]', { timeout: 10000 });
  assert.equal(await page.locator('dialog.hdp-dialog[open] h3').textContent(), 'Someone else changed this zine');
  await shot(page, 'zine-b-conflict');
  await page.click('dialog.hdp-dialog button:has-text("Keep mine")');
  s = await untilSaved(page, 'Keep mine');
  const savedB = texts((await serverCopy(page)).document);
  assert.ok(!savedB.includes('Scrap from tab two') && savedB.includes('Hot Dog Press · muestra / sample'), 'Keep mine saved over tab two');
  const kinds = new Set(s.doc.pages.flatMap((p) => p.items).map((i) => i.type));
  for (const k of ['text', 'shape', 'sticker', 'ink']) assert.ok(kinds.has(k), `zine B has ${k}`);
  assert.equal(s.doc.look, 'copy-shop');
  await goPage(page, 1);
  await shot(page, 'zine-b-editor');

  await page.click('.hdp-export summary');
  await savePdf(page, 'zine-b-letter.pdf', 'letter');
  await cspCheck(page, 'admin');
  await ctx.close();

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
    project_id: PROJECT, zine_a: zineA, zine_b: zineB, mustard_warnings_a: warningsA, files: manifest,
  }, null, 2) + '\n');
  assert.deepEqual(problems, [], 'no console errors, page errors, CSP violations or other origins');
  console.log(`PASS sample E2E (project ${PROJECT}, zines ${zineA} and ${zineB}); files in ${OUT}`);
  for (const [f, size] of Object.entries(manifest)) console.log(`  ${f}: ${size}`);
} catch (err) {
  console.error('FAIL', err);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
