// Browser end-to-end run of the zine editor (Task 11) on the :8081 dev stack, headless Chromium via Playwright from
// the harness root's node_modules. Desktop (1280) and phone (375) widths:
//
//   create a zine → add text (typed in place) → draw ink → a shape → a sticker → upload a photo → move, resize,
//   rotate, undo/redo, lock → apply a layout (hand items stay) → change the look → paste Mustard and Apply (warnings
//   shown, hand ink kept) → bad Mustard shows errors and changes nothing → reorder pages in the strip → Pages / Sheet /
//   Booklet → save once through the save route and reload (the server's strict validator accepts the document) →
//   a viewer gets read-only mode → the same at 375 px (toolbar and strip scroll, no page-wide horizontal scroll).
// Every page must log no console error, no page error and no CSP violation, and request nothing from another origin.
//
// A viewer user and the zine are made and removed with PDO inside kb-suite (dev only; never the production MCP).
// Run from the harness root: node HotDogPress/Test/e2e/editor.e2e.mjs [shots-dir]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const BASE = process.env.KB_URL || 'http://localhost:8081';
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`refusing: KB_URL must be a localhost dev stack, not ${BASE}`);
  process.exit(2);
}
const CONTAINER = process.env.KB_CONTAINER || 'kb-suite';
const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = resolve(process.argv[2] || join(PLUGIN, 'Test/e2e/shots'));
const PHOTO = join(PLUGIN, 'Test/fixtures/pdf/two-tone.jpg');
const PROJECT_ID = 1;
const tag = randomBytes(3).toString('hex');
const VIEWER = { username: `hdp-viewer-${tag}`, password: randomBytes(12).toString('base64url') };
const MUSTARD = readFileSync(join(PLUGIN, 'Test/fixtures/mustard/example.mustard.md'), 'utf8');
mkdirSync(SHOTS, { recursive: true });

/** Runs PHP with PDO on the dev stack's SQLite database; the script gets $db. Returns stdout. */
function php(code, ...args) {
  const prelude = '$db = new PDO("sqlite:/var/www/app/data/db.sqlite"); $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); $db->exec("PRAGMA foreign_keys = ON");';
  return execFileSync('docker', ['exec', CONTAINER, 'php', '-r', prelude + code, '--', ...args], { encoding: 'utf8' });
}

const problems = [];
/** Watches a page for console errors, page errors, CSP violations and requests to other origins. */
function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${label} console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${label} pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${label} HTTP ${r.status()}: ${r.url()}`); });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['http:', 'https:'].includes(u.protocol)) return;
    if (u.origin !== new URL(BASE).origin) problems.push(`${label} other origin: ${r.url()}`);
  });
}
const CSP_PROBE = () => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
};
async function cspCheck(page, label) {
  const v = await page.evaluate(() => window.__csp ?? []);
  for (const x of v) problems.push(`${label} CSP: ${x}`);
}

async function login(context, username, password) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', password);
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
  return page;
}

/** The editor module's live state: the same module instance the page booted (same URL, query included). */
const state = (page) => page.evaluate(async () => {
  const src = document.querySelector('script[type=module][src*="HotDogPress/Assets/js/app/main.js"]').src;
  const m = await import(src);
  await m.ready;
  const e = m.editor;
  return e && { doc: e.store.doc, selection: e.store.selection, page: e.store.page, ui: e.ui, canUndo: e.store.canUndo, revision: e.config.revision };
});
const items = (s, p = s.page) => s.doc.pages[p].items;
/** Polls the editor state until `pred(state)` holds. */
async function until(page, pred, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const s = await state(page);
    if (pred(s)) return s;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await page.waitForTimeout(100);
  }
}

async function overlayBox(page) {
  const b = await page.locator('.hdp-overlay').boundingBox();
  assert.ok(b && b.width > 50, 'the page canvas is laid out');
  return { ...b, at: (fx, fy) => ({ x: b.x + fx * b.width, y: b.y + fy * b.height }) };
}

async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });

const browser = await chromium.launch();
let zineId = null;
let viewerId = null;
try {
  // ------------------------------------------------------------ desktop: make a zine by hand
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(CSP_PROBE);
  const page = await login(ctx, 'admin', 'admin');
  watch(page, 'desktop');
  await page.goto(`${BASE}/hotdogpress/project/${PROJECT_ID}`);
  await page.fill('form[action*="/create"] input[name=title]', `E2E zine ${tag}`);
  await Promise.all([
    page.waitForURL(/\/hotdogpress\/zine\/\d+$/),
    page.locator('form[action*="/create"] [type=submit]').click(),
  ]);
  zineId = Number(/zine\/(\d+)/.exec(page.url())[1]);
  await page.waitForSelector('#hotdogpress-app[data-ready="true"]');
  let s = await state(page);
  assert.equal(s.doc.pages.length, 8);
  assert.equal(s.ui.view, 'pages');
  await page.waitForFunction(() => document.fonts.check('20px "Anton"') && document.fonts.check('20px "Atkinson Hyperlegible"'));
  await shot(page, 'desktop-01-empty');

  // Text: tap the page with the Text tool and type.
  let box = await overlayBox(page);
  await page.click('[data-tool="text"]');
  await page.mouse.click(box.at(0.12, 0.1).x, box.at(0.12, 0.1).y);
  await page.waitForSelector('.hdp-text-edit:not([hidden])');
  await page.keyboard.type('Hello, zine!');
  await page.keyboard.press('Escape');
  s = await state(page);
  const text = items(s).find((i) => i.type === 'text');
  assert.equal(text?.runs[0].text, 'Hello, zine!', 'typed text is in the document');
  assert.equal(text.by, 'hand');

  // Ink: a wavy stroke.
  await page.click('[data-tool="ink"]');
  await page.mouse.move(box.at(0.15, 0.6).x, box.at(0.15, 0.6).y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    const p = box.at(0.15 + i * 0.022, 0.6 + Math.sin(i / 3) * 0.06);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  s = await state(page);
  const ink = items(s).find((i) => i.type === 'ink');
  assert.ok(ink && ink.points.length >= 3 && ink.points.length < 31, `ink smoothed and simplified: ${ink?.points.length} points`);
  assert.ok(ink.points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1), 'ink in panel units');

  // Shape: drag out an ellipse.
  await page.click('[data-tool="shape"]');
  await page.click('.hdp-props button:has-text("Ellipse")');
  const shapeBox = await overlayBox(page);
  assert.deepEqual([shapeBox.x, shapeBox.y], [box.x, box.y], 'the page does not jump when the options row changes');
  await drag(page, box.at(0.55, 0.25), box.at(0.85, 0.4));
  s = await state(page);
  const shape = items(s).find((i) => i.type === 'shape');
  assert.equal(shape?.shape, 'ellipse');
  assert.ok(Math.abs(shape.w - 0.3) < 0.02 && Math.abs(shape.h - 0.15) < 0.02, 'dragged size');

  // Sticker: the hot dog, inline as a data: URL asset.
  await page.click('[data-tool="sticker"]');
  await page.click('.hdp-sticker[aria-label="Hot dog"]');
  s = await until(page, (x) => items(x, 0).some((i) => i.type === 'sticker'), 'the sticker');
  const sticker = items(s).find((i) => i.type === 'sticker');
  assert.ok(sticker, JSON.stringify(items(s).map((i) => i.type)) + ' page ' + s.page);
  assert.match(s.doc.assets[sticker.asset].data, /^data:image\/svg\+xml;base64,/);


  // Select, move, resize, rotate the shape; undo and redo; lock.
  await page.click('[data-tool="select"]');
  box = await overlayBox(page);
  const sc = box.at(shape.x + shape.w / 2, shape.y + shape.h / 2);
  await drag(page, sc, { x: sc.x - 40, y: sc.y + 30 });
  s = await state(page);
  let moved = items(s).find((i) => i.id === shape.id);
  assert.ok(moved.x < shape.x && moved.y > shape.y, 'moved ' + JSON.stringify({ shape, moved, sel: s.selection, tool: s.ui.tool }));
  assert.deepEqual(s.selection, [shape.id]);
  const se = box.at(moved.x + moved.w, moved.y + moved.h);
  await drag(page, se, { x: se.x + 30, y: se.y + 20 });
  s = await state(page);
  const resized = items(s).find((i) => i.id === shape.id);
  assert.ok(resized.w > moved.w && resized.h > moved.h, 'resized');
  const top = box.at(resized.x + resized.w / 2, resized.y);
  await drag(page, { x: top.x, y: top.y - 28 }, { x: top.x + 120, y: top.y + 40 });
  s = await state(page);
  const turned = items(s).find((i) => i.id === shape.id);
  assert.ok(turned.rot > 20 && turned.rot < 160, `rotated: ${turned.rot}`);
  await page.click('.hdp-toolbar button:has-text("Undo")');
  s = await state(page);
  assert.equal(items(s).find((i) => i.id === shape.id).rot ?? 0, resized.rot ?? 0, 'undo puts the rotation back');
  await page.keyboard.press('Control+Shift+Z');
  s = await state(page);
  assert.equal(items(s).find((i) => i.id === shape.id).rot, turned.rot, 'redo');
  await page.click('.hdp-toolbar button:has-text("Lock")');
  s = await state(page);
  assert.equal(items(s).find((i) => i.id === shape.id).locked, true);
  await drag(page, box.at(0.5, 0.33), box.at(0.2, 0.2));
  s = await state(page);
  assert.equal(items(s).find((i) => i.id === shape.id).x, turned.x, 'a locked item does not move');

  // Delete the sticker with the keyboard, then undo it back.
  const stc = box.at(sticker.x + sticker.w / 2, sticker.y + sticker.h / 2);
  await page.mouse.click(stc.x, stc.y);
  s = await state(page);
  if (s.selection[0] === sticker.id) {
    await page.keyboard.press('Delete');
    s = await state(page);
    assert.ok(!items(s).some((i) => i.id === sticker.id), 'deleted');
    await page.keyboard.press('Control+z');
    s = await state(page);
    assert.ok(items(s).some((i) => i.id === sticker.id), 'undo brings it back');
  }

  // Photo: through the file input, downscaled and uploaded; drawn from an ImageBitmap.
  await page.locator('.hdp-file').setInputFiles(PHOTO);
  s = await until(page, (x) => items(x, 0).some((i) => i.type === 'image'), 'the photo');
  const photo = items(s).find((i) => i.type === 'image');
  const asset = s.doc.assets[photo.asset];
  assert.equal(asset.kind, 'image');
  assert.ok(Number.isInteger(asset.file_id) && asset.w <= 1300 && asset.h <= 1300, 'uploaded and at most 1300 px');
  assert.equal(await page.locator('.hdp-status[data-kind="error"]').count(), 0, 'no upload error shown');
  const imgStatus = await page.evaluate((id) => fetch(document.querySelector('#hotdogpress-config') && JSON.parse(document.querySelector('#hotdogpress-config').textContent).routes.image.replace('{file_id}', id)).then((r) => r.status), asset.file_id);
  assert.equal(imgStatus, 200, 'the image route serves the upload');
  await shot(page, 'desktop-02-hand-made');

  // Layout on page 2: the slot items appear; then a hand item on page 1 survives a layout change there.
  await page.locator('.hdp-thumb').nth(1).click();
  await page.selectOption('select[name=layout]', 'headline-body');
  s = await state(page);
  assert.equal(s.page, 1);
  assert.deepEqual(items(s).filter((i) => i.slot).map((i) => i.slot).sort(), ['body', 'title']);
  await page.locator('.hdp-thumb').nth(0).click();
  await page.selectOption('select[name=layout]', 'photo-caption');
  s = await state(page);
  assert.ok(items(s, 0).some((i) => i.id === ink.id) && items(s, 0).some((i) => i.id === text.id), 'hand items kept');
  await page.selectOption('select[name=look]', 'night');
  await page.check('input[name=safe_area]');
  s = await state(page);
  assert.equal(s.doc.look, 'night');
  await shot(page, 'desktop-03-layout-night-safe-area');

  // Mustard: bad text first (errors, nothing applied), then the Plant Medicine example.
  await page.click('.hdp-mustard-toggle');
  await page.waitForSelector('.hdp-mustard:not([hidden])');
  const exported = await page.inputValue('.hdp-mustard-text');
  assert.match(exported, /^---\n(#[^\n]*\n)?mustard: 1\n/);
  const before = (await state(page)).doc;
  await page.fill('.hdp-mustard-text', '---\nmustard: 2\n---\n');
  await page.click('.hdp-mustard button:has-text("Apply")');
  await page.waitForSelector('.hdp-note-error');
  assert.deepEqual((await state(page)).doc, before, 'errors change nothing');
  await page.fill('.hdp-mustard-text', MUSTARD);
  await page.click('.hdp-mustard button:has-text("Apply")');
  await page.waitForSelector('.hdp-note-ok');
  s = await state(page);
  assert.equal(s.doc.title, 'Plant Medicine');
  assert.equal(s.doc.pages[0].layout, 'cover');
  assert.ok(items(s, 0).some((i) => i.id === ink.id), 'hand ink kept through Apply');
  assert.ok(await page.locator('.hdp-note-warning li').count() > 0, 'warnings listed (unknown photos, short zine)');
  await shot(page, 'desktop-04-mustard-applied');
  await page.click('.hdp-mustard button:has-text("Close")');

  // Reorder: drag page 1's thumbnail onto page 3.
  const ids = (await state(page)).doc.pages.map((p) => p.id);
  await page.locator('.hdp-strip').scrollIntoViewIfNeeded();
  const t0 = await page.locator('.hdp-thumb').nth(0).boundingBox();
  const t2 = await page.locator('.hdp-thumb').nth(2).boundingBox();
  await drag(page, { x: t0.x + t0.width / 2, y: t0.y + t0.height / 2 }, { x: t2.x + t2.width / 2, y: t2.y + t2.height / 2 });
  s = await state(page);
  assert.deepEqual(s.doc.pages.map((p) => p.id), [ids[1], ids[2], ids[0], ...ids.slice(3)], 'page moved with its id');
  assert.ok(items(s, 2).some((i) => i.id === ink.id), 'its items moved with it');
  await page.keyboard.press('Control+z');

  // Views.
  await page.click('.hdp-tab[data-view="sheet"]');
  await page.waitForSelector('.hdp-view-sheet:not([hidden]) canvas');
  await shot(page, 'desktop-05-sheet');
  const sheet = await page.locator('.hdp-sheet-canvas').boundingBox();
  // Page 2 sits top right, upside down: tapping it opens page 2.
  await page.mouse.click(sheet.x + sheet.width * 0.875, sheet.y + sheet.height * 0.25);
  s = await state(page);
  assert.equal(s.ui.view, 'pages');
  assert.equal(s.page, 1);
  await page.click('.hdp-tab[data-view="booklet"]');
  await page.click('.hdp-flip[aria-label="Next page"]');
  assert.equal(await page.textContent('.hdp-booklet-label'), 'Page 2–3');
  await shot(page, 'desktop-06-booklet');
  await page.click('.hdp-tab[data-view="pages"]');

  // Save once through the route (autosave is Task 12) and reload: the server accepts the document, it comes back.
  s = await state(page);
  const saved = await page.evaluate(async ({ doc, revision }) => {
    const c = JSON.parse(document.getElementById('hotdogpress-config').textContent);
    const body = new FormData();
    body.append('csrf_token', c.csrf_token);
    body.append('revision', String(revision));
    body.append('document', JSON.stringify(doc));
    const r = await fetch(c.routes.save, { method: 'POST', body });
    return { status: r.status, json: await r.json() };
  }, { doc: s.doc, revision: s.revision });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  await page.reload();
  await page.waitForSelector('#hotdogpress-app[data-ready="true"]');
  const reloaded = await state(page);
  assert.deepEqual(reloaded.doc, s.doc, 'the saved zine loads back unchanged');
  await cspCheck(page, 'desktop');
  await ctx.close();

  // ------------------------------------------------------------ a viewer: read-only
  viewerId = Number(php(`
    $db->prepare("INSERT INTO users (username, password, name, role, is_active) VALUES (?, ?, ?, 'app-user', 1)")
      ->execute([$argv[1], password_hash($argv[2], PASSWORD_BCRYPT), 'Zine viewer']);
    $id = $db->lastInsertId();
    $db->prepare("INSERT INTO project_has_users (project_id, user_id, role) VALUES (?, ?, 'project-viewer')")->execute([${PROJECT_ID}, $id]);
    echo $id;`, VIEWER.username, VIEWER.password));
  const vctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await vctx.addInitScript(CSP_PROBE);
  const vpage = await login(vctx, VIEWER.username, VIEWER.password);
  watch(vpage, 'viewer');
  await vpage.goto(`${BASE}/hotdogpress/zine/${zineId}`);
  await vpage.waitForSelector('#hotdogpress-app[data-ready="true"]');
  assert.equal(await vpage.locator('.hdp-tool').count(), 0, 'no tools');
  assert.equal(await vpage.locator('.hdp-read-only').count(), 1, 'read-only note');
  assert.ok(await vpage.locator('select[name=layout]').isDisabled(), 'pickers disabled');
  const vs = await state(vpage);
  const vbox = await overlayBox(vpage);
  await drag(vpage, vbox.at(0.5, 0.5), vbox.at(0.2, 0.2));
  assert.deepEqual((await state(vpage)).doc, vs.doc, 'a viewer cannot change the zine');
  await vpage.click('.hdp-mustard-toggle');
  assert.ok(await vpage.locator('.hdp-mustard-text').getAttribute('readonly') !== null, 'Mustard is read-only');
  assert.equal(await vpage.locator('.hdp-mustard button:has-text("Apply")').count(), 0);
  await shot(vpage, 'viewer-01-read-only');
  await cspCheck(vpage, 'viewer');
  await vctx.close();

  // ------------------------------------------------------------ phone: 375 px
  const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await mctx.addInitScript(CSP_PROBE);
  const mpage = await login(mctx, 'admin', 'admin');
  watch(mpage, 'phone');
  await mpage.goto(`${BASE}/hotdogpress/zine/${zineId}`);
  await mpage.waitForSelector('#hotdogpress-app[data-ready="true"]');
  const widths = await mpage.evaluate(() => {
    const app = document.getElementById('hotdogpress-app');
    return {
      app: app.getBoundingClientRect().right,
      toolbar: [document.querySelector('.hdp-toolbar').scrollWidth, document.querySelector('.hdp-toolbar').clientWidth],
      strip: [document.querySelector('.hdp-strip-list').scrollWidth, document.querySelector('.hdp-strip-list').clientWidth],
      settingsOpen: document.querySelector('.hdp-settings').open,
      canvas: document.querySelector('.hdp-overlay').getBoundingClientRect().width,
    };
  });
  assert.ok(widths.app <= 375, `the editor fits the phone width: ${JSON.stringify(widths)}`);
  assert.ok(widths.toolbar[0] > widths.toolbar[1], 'the toolbar scrolls sideways');
  assert.ok(widths.strip[0] > widths.strip[1], 'the strip scrolls sideways');
  assert.equal(widths.settingsOpen, false, 'settings fold away on a phone');
  assert.ok(widths.canvas > 250 && widths.canvas <= 375, `page fills the width: ${widths.canvas}`);
  await shot(mpage, 'phone-01-pages');
  // Text by touch.
  await mpage.locator('[data-tool="text"]').tap();
  await mpage.locator('.hdp-overlay').scrollIntoViewIfNeeded();
  let mbox = await overlayBox(mpage);
  await mpage.touchscreen.tap(mbox.at(0.2, 0.85).x, mbox.at(0.2, 0.85).y);
  await mpage.waitForSelector('.hdp-text-edit:not([hidden])');
  await mpage.keyboard.type('From my phone');
  await mpage.keyboard.press('Escape');
  const ms = await state(mpage);
  assert.ok(items(ms).some((i) => i.type === 'text' && i.runs[0].text === 'From my phone'), 'text by touch');
  // Ink with the (emulated) pointer.
  await mpage.locator('[data-tool="ink"]').tap();
  await mpage.locator('.hdp-overlay').scrollIntoViewIfNeeded();
  mbox = await overlayBox(mpage);
  await drag(mpage, mbox.at(0.2, 0.7), mbox.at(0.8, 0.75), 15);
  assert.ok(items(await state(mpage)).filter((i) => i.type === 'ink').length >= 1, 'ink on the phone');
  await shot(mpage, 'phone-02-edited');
  await mpage.locator('.hdp-tab[data-view="sheet"]').tap();
  await shot(mpage, 'phone-03-sheet');
  await mpage.locator('.hdp-tab[data-view="booklet"]').tap();
  await shot(mpage, 'phone-04-booklet');
  await mpage.locator('.hdp-tab[data-view="pages"]').tap();
  await mpage.locator('.hdp-mustard-toggle').tap();
  await shot(mpage, 'phone-05-mustard');
  await cspCheck(mpage, 'phone');
  await mctx.close();

  assert.deepEqual(problems, [], 'no console errors, page errors, CSP violations or other origins');
  console.log(`PASS editor E2E (zine ${zineId}); screenshots in ${SHOTS}`);
} catch (err) {
  console.error('FAIL', err);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  // Clean up: the zine, its uploaded photos (project files named hotdogpress-<id>-…) and the viewer.
  if (zineId) {
    php(`
      $files = $db->prepare("SELECT path FROM project_has_files WHERE project_id = ? AND name LIKE ?");
      $files->execute([${PROJECT_ID}, "hotdogpress-" . $argv[1] . "-%"]);
      foreach ($files->fetchAll(PDO::FETCH_COLUMN) as $p) { @unlink("/var/www/app/data/files/" . $p); @unlink("/var/www/app/data/files/" . $p . ".thumb"); }
      $db->prepare("DELETE FROM project_has_files WHERE project_id = ? AND name LIKE ?")->execute([${PROJECT_ID}, "hotdogpress-" . $argv[1] . "-%"]);
      $db->prepare("DELETE FROM hotdogpress_zines WHERE id = ?")->execute([$argv[1]]);`, String(zineId));
  }
  if (viewerId) {
    php('$db->prepare("DELETE FROM project_has_users WHERE user_id = ?")->execute([$argv[1]]); $db->prepare("DELETE FROM users WHERE id = ?")->execute([$argv[1]]);', String(viewerId));
  }
}
