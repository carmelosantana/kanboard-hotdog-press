// Browser end-to-end run of autosave, the conflict prompt and the exports (Task 12) on the :8081 dev stack, headless
// Chromium via Playwright from the harness root's node_modules:
//
//   a reload mid-edit, with the pagehide beacon blocked, keeps the edit (the sessionStorage buffer) and it then
//   reaches the server → two tabs: the stale one gets "Someone else changed this zine"; Keep mine saves over, Reload
//   takes the server copy → the carousel ZIP holds 8 PNGs at 1080 × 1440 in page order; 4:5, cover, pin, story,
//   sheet and Bluesky sizes → the print PDF (with the "Actual size" note) and its B&W panels are gray → the LinkedIn
//   PDF has 8 pages → "Save PDF to project files" stores a PDF in the project.
// Every page must log no console error, no page error and no CSP violation, and request nothing from another origin.
// Run from the harness root: node HotDogPress/Test/e2e/exports.e2e.mjs [shots-dir]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  PLUGIN, PROJECT_ID, php, problems, watch, CSP_PROBE, cspCheck, login, state, items, until, serverCopy,
  createZine, removeZine,
} from './lib.mjs';
import { readZip } from '../js/helpers/zip-reader.mjs';

const tag = randomBytes(3).toString('hex');
const SHOTS = resolve(process.argv[2] || join(PLUGIN, 'Test/e2e/shots'));
mkdirSync(SHOTS, { recursive: true });
const MUSTARD = readFileSync(join(PLUGIN, 'Test/fixtures/mustard/example.mustard.md'), 'utf8');
/** The 409s this run causes on purpose (the stale tab's saves). */
const conflict409 = (r) => r.status() === 409 && /\/save$/.test(new URL(r.url()).pathname);

/** Types `text` into a new text box at (fx, fy) of the page canvas. */
async function addText(page, text, fx = 0.15, fy = 0.15) {
  const b = await page.locator('.hdp-overlay').boundingBox();
  await page.click('[data-tool="text"]');
  await page.mouse.click(b.x + fx * b.width, b.y + fy * b.height);
  await page.waitForSelector('.hdp-text-edit:not([hidden])');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await page.click('[data-tool="select"]');
}
const texts = (doc) => doc.pages.flatMap((p) => p.items).filter((i) => i.type === 'text').map((i) => i.runs.map((r) => r.text).join(''));

/** Waits until the server's copy is exactly the tab's zine. */
async function untilSaved(page, what) {
  const end = Date.now() + 20000;
  for (;;) {
    const s = await state(page);
    if (s.saveState === 'saved' && JSON.stringify((await serverCopy(page)).document) === JSON.stringify(s.doc)) return s;
    assert.ok(Date.now() < end, `timed out waiting for ${what} to be saved`);
    await page.waitForTimeout(250);
  }
}

/** Clicks an export button and returns the download's name and bytes. */
async function download(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click(selector)]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(readFileSync(await dl.path())) };
}
/** Width and height from a PNG's IHDR. */
function pngSize(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'a PNG');
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  return [v.getUint32(16), v.getUint32(20)];
}
const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

const browser = await chromium.launch();
let zineId = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, acceptDownloads: true });
  await ctx.addInitScript(CSP_PROBE);
  const page = await login(ctx, 'admin', 'admin');
  watch(page, 'tab one', { expect: conflict409 });
  zineId = await createZine(page, `E2E exports ${tag}`);

  // ------------------------------------------------------------ a reload mid-edit keeps the edit
  // 1. The beacon is lost (sendBeacon stubbed to drop it), so only the sessionStorage buffer can bring the edit back.
  //    (Playwright does not surface unload beacons as requests, so they cannot be routed; the stub stands in.)
  await addText(page, 'Before reload');
  let s = await state(page);
  assert.equal(s.saveState, 'dirty', 'reloading inside the 2 s debounce, before any save');
  const buffer = await page.evaluate((id) => sessionStorage.getItem(`hotdogpress:zine:${id}`), zineId);
  assert.ok(buffer?.includes('Before reload'), 'the edit is in the sessionStorage buffer');
  await page.evaluate(() => { navigator.sendBeacon = () => true; });
  await page.reload();
  await page.waitForSelector('#hotdogpress-app[data-ready="true"]');
  assert.equal((await serverCopy(page)).revision, s.revision, 'nothing reached the server before the reload');
  s = await state(page);
  assert.deepEqual(texts(s.doc), ['Before reload'], 'the edit is back after the reload');
  s = await untilSaved(page, 'the recovered edit');
  assert.deepEqual(texts((await serverCopy(page)).document), ['Before reload'], 'and the server has it');
  assert.equal(await page.evaluate((id) => sessionStorage.getItem(`hotdogpress:zine:${id}`), zineId), null, 'the buffer is gone once saved');
  // 2. With the real beacon: the edit survives a reload as well (by the beacon, or the buffer if it lands late).
  await addText(page, 'Beaconed', 0.15, 0.85);
  assert.equal((await state(page)).saveState, 'dirty');
  await page.reload();
  await page.waitForSelector('#hotdogpress-app[data-ready="true"]');
  assert.deepEqual(texts((await state(page)).doc), ['Before reload', 'Beaconed']);
  await untilSaved(page, 'the beaconed edit');
  s = await state(page);

  // ------------------------------------------------------------ two tabs: the 409 prompt
  const page2 = await ctx.newPage();
  watch(page2, 'tab two', { expect: conflict409 });
  await page2.goto(page.url());
  await page2.waitForSelector('#hotdogpress-app[data-ready="true"]');
  await addText(page2, 'Tab two', 0.15, 0.5);
  await untilSaved(page2, 'tab two');
  await addText(page, 'Tab one', 0.15, 0.7);
  await page.waitForSelector('dialog.hdp-dialog[open]', { timeout: 10000 });
  assert.equal(await page.locator('dialog.hdp-dialog[open] h3').textContent(), 'Someone else changed this zine');
  assert.equal((await state(page)).saveState, 'conflict');
  await page.screenshot({ path: join(SHOTS, 'exports-01-conflict.png') });
  await page.click('dialog.hdp-dialog button:has-text("Keep mine")');
  s = await untilSaved(page, 'Keep mine');
  assert.deepEqual(texts((await serverCopy(page)).document), ['Before reload', 'Beaconed', 'Tab one'], 'Keep mine saved over tab two');
  // Tab two is stale now: its next edit meets the prompt; Reload takes the server copy.
  await addText(page2, 'Lost edit', 0.15, 0.3);
  await page2.waitForSelector('dialog.hdp-dialog[open]', { timeout: 10000 });
  await Promise.all([page2.waitForNavigation(), page2.click('dialog.hdp-dialog button:has-text("Reload")')]);
  await page2.waitForSelector('#hotdogpress-app[data-ready="true"]');
  assert.deepEqual(texts((await state(page2)).doc), ['Before reload', 'Beaconed', 'Tab one'], 'Reload shows the server copy');
  assert.equal(await page2.evaluate((id) => sessionStorage.getItem(`hotdogpress:zine:${id}`), zineId), null, 'the lost edit is not resurrected');
  await cspCheck(page2, 'tab two');
  await page2.close();

  // ------------------------------------------------------------ exports from a full zine (the Mustard example)
  await page.click('.hdp-mustard-toggle');
  await page.fill('.hdp-mustard-text', MUSTARD);
  await page.click('.hdp-mustard button:has-text("Apply")');
  await page.waitForSelector('.hdp-note-ok');
  await page.click('.hdp-mustard button:has-text("Close")');
  s = await untilSaved(page, 'the Mustard zine');
  const zslug = 'plant-medicine';
  await page.click('.hdp-export summary');
  assert.equal(await page.locator('.hdp-print-note').textContent(), 'Print at Actual size (100%), on Letter, one side.');

  // Carousel 3:4: 8 frames at 1080 x 1440, pages 1..8 in order, each its own picture.
  const carousel = await download(page, '[data-export="carousel"]');
  assert.equal(carousel.name, `hotdog-${zslug}-carousel-3x4.zip`);
  const frames = readZip(carousel.bytes);
  assert.deepEqual(frames.map((e) => e.name), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `hotdog-${zslug}-carousel-3x4-0${n}.png`));
  for (const f of frames) assert.deepEqual(pngSize(f.data), [1080, 1440], f.name);
  // In page order: two frames are the same picture exactly when their pages have the same content.
  const content = s.doc.pages.map(({ id, ...rest }) => JSON.stringify({ ...rest, items: rest.items.map(({ id: _, ...it }) => it) }));
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      assert.equal(latin1(frames[i].data) === latin1(frames[j].data), content[i] === content[j], `frames ${i + 1} and ${j + 1}`);
    }
  }
  assert.ok(new Set(content).size >= 4, 'the zine has distinct pages to tell apart');
  // Frame n is page n: the first frame matches the cover image (page 1) pixel for pixel.
  const cover = await download(page, '[data-export="cover"]');
  assert.equal(cover.name, `hotdog-${zslug}-cover.png`);
  assert.deepEqual(pngSize(cover.bytes), [1080, 1440]);
  assert.equal(latin1(frames[0].data), latin1(cover.bytes), 'carousel frame 1 is the cover page');
  await page.selectOption('select[name=carousel_ratio]', 'carousel-4x5');
  const four5 = readZip((await download(page, '[data-export="carousel"]')).bytes);
  assert.deepEqual(four5.map((f) => pngSize(f.data)), Array(8).fill([1080, 1350]));
  for (const [id, size] of [['pin', [1000, 1500]], ['story', [1080, 1920]], ['sheet', [2160, 1528]]]) {
    const file = await download(page, `[data-export="${id}"]`);
    assert.equal(file.name, `hotdog-${zslug}-${id}.png`);
    assert.deepEqual(pngSize(file.bytes), size, id);
  }
  assert.equal(readZip((await download(page, '[data-export="bluesky"]')).bytes).length, 4, 'Bluesky set of 4');

  // Print PDF, then its B&W panels are gray in a real canvas.
  const pdf = await download(page, '[data-export="pdf"]');
  assert.equal(pdf.name, `hotdog-${zslug}-letter.pdf`);
  assert.ok(latin1(pdf.bytes).startsWith('%PDF-1.4'), 'a PDF');
  assert.match(await page.locator('.hdp-status').textContent(), /Order up · Print at Actual size \(100%\), on Letter, one side\./);
  const gray = await page.evaluate(async () => {
    const base = document.querySelector('script[type=module][src*="HotDogPress/Assets/js/app/main.js"]').src;
    const m = await import(base);
    const ex = await import(new URL('./exports.js', base).href);
    const doc = m.editor.store.doc;
    const spread = async (bw) => {
      const [panel] = await ex.rasterPanels(doc, m.editor.images.map, { bw, dpi: 40 });
      const bmp = await createImageBitmap(new Blob([panel.jpeg], { type: 'image/jpeg' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      let worst = 0;
      for (let i = 0; i < d.length; i += 4) worst = Math.max(worst, Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2]));
      return worst;
    };
    return { colour: await spread(false), bw: await spread(true) };
  });
  assert.ok(gray.colour > 20, `the colour panel has colour (max channel spread ${gray.colour})`);
  assert.ok(gray.bw <= 3, `the B&W panel is gray (max channel spread ${gray.bw})`);
  await page.check('input[name=export_bw]');
  await page.uncheck('input[name=export_guides]');
  const bwPdf = await download(page, '[data-export="pdf"]');
  assert.ok(latin1(bwPdf.bytes).startsWith('%PDF-1.4') && bwPdf.bytes.length !== pdf.bytes.length, 'B&W without guides is another PDF');

  const linkedin = await download(page, '[data-export="linkedin"]');
  assert.equal(linkedin.name, `hotdog-${zslug}-linkedin.pdf`);
  assert.equal((latin1(linkedin.bytes).match(/\/Type \/Page\b/g) ?? []).length, 8, 'LinkedIn PDF has 8 pages');

  // Save PDF to project files.
  await page.click('[data-export="save-pdf"]');
  await page.waitForFunction(() => /Saved to the project files as/.test(document.querySelector('.hdp-status').textContent), null, { timeout: 120000 });
  const stored = JSON.parse(php(`
    $q = $db->prepare("SELECT name, path FROM project_has_files WHERE project_id = ? AND name LIKE ?");
    $q->execute([${PROJECT_ID}, "hotdogpress-" . $argv[1] . "-%.pdf"]);
    $rows = $q->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) { $r["head"] = substr((string) @file_get_contents("/var/www/app/data/files/" . $r["path"]), 0, 8); }
    echo json_encode($rows);`, String(zineId)));
  assert.equal(stored.length, 1, JSON.stringify(stored));
  assert.equal(stored[0].name, `hotdogpress-${zineId}-${zslug}-letter.pdf`);
  assert.equal(stored[0].head, '%PDF-1.4');
  await page.screenshot({ path: join(SHOTS, 'exports-02-menu.png'), fullPage: true });

  await cspCheck(page, 'tab one');
  await ctx.close();
  assert.deepEqual(problems, [], 'no console errors, page errors, CSP violations or other origins');
  console.log(`PASS exports E2E (zine ${zineId})`);
} catch (err) {
  console.error('FAIL', err);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  if (zineId) removeZine(zineId);
}
