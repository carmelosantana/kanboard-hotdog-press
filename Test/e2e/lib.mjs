// Shared pieces of the editor E2E runs on the :8081 dev stack: the localhost guard, PDO inside kb-suite (dev only;
// never the production MCP), a watcher for console errors, page errors, failed responses, CSP violations and other
// origins, login, the editor's live state, and making and removing a zine.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = process.env.KB_URL || 'http://localhost:8081';
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`refusing: KB_URL must be a localhost dev stack, not ${BASE}`);
  process.exit(2);
}
export const CONTAINER = process.env.KB_CONTAINER || 'kb-suite';
export const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PROJECT_ID = 1;

/** Runs PHP with PDO on the dev stack's SQLite database; the script gets $db. Returns stdout. */
export function php(code, ...args) {
  const prelude = '$db = new PDO("sqlite:/var/www/app/data/db.sqlite"); $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); $db->exec("PRAGMA foreign_keys = ON");';
  return execFileSync('docker', ['exec', CONTAINER, 'php', '-r', prelude + code, '--', ...args], { encoding: 'utf8' });
}

/** Everything a watched page did wrong; a run passes only when this stays empty. */
export const problems = [];
/**
 * Watches a page for console errors, page errors, failed responses and requests to other origins.
 * @param {{expect?: (r: any) => boolean, quiet?: (text: string) => boolean}} [opts] `expect` marks a response the run
 *   causes on purpose (a 409), `quiet` the console error the browser logs for it (a 409's is always quiet)
 */
export function watch(page, label, { expect = () => false, quiet = () => false } = {}) {
  page.on('console', (m) => {
    if (m.type() === 'error' && !/the server responded with a status of 409/.test(m.text()) && !quiet(m.text())) problems.push(`${label} console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`${label} pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !expect(r)) problems.push(`${label} HTTP ${r.status()}: ${r.url()}`); });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['http:', 'https:'].includes(u.protocol)) return;
    if (u.origin !== new URL(BASE).origin) problems.push(`${label} other origin: ${r.url()}`);
  });
}
export const CSP_PROBE = () => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
};
export async function cspCheck(page, label) {
  const v = await page.evaluate(() => window.__csp ?? []);
  for (const x of v) problems.push(`${label} CSP: ${x}`);
}

export async function login(context, username, password) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', password);
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
  return page;
}

/** The editor module's live state: the same module instance the page booted (same URL, query included). */
export const state = (page) => page.evaluate(async () => {
  const src = document.querySelector('script[type=module][src*="HotDogPress/Assets/js/app/main.js"]').src;
  const m = await import(src);
  await m.ready;
  const e = m.editor;
  return e && {
    doc: e.store.doc, selection: e.store.selection, page: e.store.page, ui: e.ui, canUndo: e.store.canUndo,
    revision: e.config.revision, saveState: document.querySelector('.hdp-save-state')?.dataset.state ?? null,
  };
});
export const items = (s, p = s.page) => s.doc.pages[p].items;
/** Polls the editor state until `pred(state)` holds. */
export async function until(page, pred, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const s = await state(page);
    if (pred(s)) return s;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await page.waitForTimeout(100);
  }
}

/** The zine as the server has it: {revision, document}. */
export const serverCopy = (page) => page.evaluate(async () => {
  const c = JSON.parse(document.getElementById('hotdogpress-config').textContent);
  const r = await fetch(c.routes.load, { headers: { Accept: 'application/json' } });
  return r.json();
});

/** Creates a zine through the Zines page and waits for its editor; returns the zine id. */
export async function createZine(page, title, projectId = PROJECT_ID) {
  await page.goto(`${BASE}/hotdogpress/project/${projectId}`);
  await page.fill('form[action*="/create"] input[name=title]', title);
  await Promise.all([
    page.waitForURL(/\/hotdogpress\/zine\/\d+$/),
    page.locator('form[action*="/create"] [type=submit]').click(),
  ]);
  await page.waitForSelector('#hotdogpress-app[data-ready="true"]');
  return Number(/zine\/(\d+)/.exec(page.url())[1]);
}

/** Removes a zine and its project files (uploaded photos and saved PDFs are named hotdogpress-<id>-…). */
export function removeZine(zineId, projectId = PROJECT_ID) {
  php(`
    $files = $db->prepare("SELECT path FROM project_has_files WHERE project_id = ? AND name LIKE ?");
    $files->execute([${projectId}, "hotdogpress-" . $argv[1] . "-%"]);
    foreach ($files->fetchAll(PDO::FETCH_COLUMN) as $p) { @unlink("/var/www/app/data/files/" . $p); @unlink("/var/www/app/data/files/" . $p . ".thumb"); }
    $db->prepare("DELETE FROM project_has_files WHERE project_id = ? AND name LIKE ?")->execute([${projectId}, "hotdogpress-" . $argv[1] . "-%"]);
    $db->prepare("DELETE FROM hotdogpress_zines WHERE id = ?")->execute([$argv[1]]);`, String(zineId));
}

/** Types `text` into a new text box at (fx, fy) of the page canvas; the text stays selected, the Select tool is on. */
export async function addText(page, text, fx = 0.15, fy = 0.15) {
  const b = await page.locator('.hdp-overlay').boundingBox();
  await page.click('[data-tool="text"]');
  await page.mouse.click(b.x + fx * b.width, b.y + fy * b.height);
  await page.waitForSelector('.hdp-text-edit:not([hidden])');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await page.click('[data-tool="select"]');
}
export const texts = (doc) => doc.pages.flatMap((p) => p.items).filter((i) => i.type === 'text').map((i) => i.runs.map((r) => r.text).join(''));

/** Waits until the server's copy is exactly the tab's zine. */
export async function untilSaved(page, what) {
  const end = Date.now() + 20000;
  for (;;) {
    const s = await state(page);
    if (s.saveState === 'saved' && JSON.stringify((await serverCopy(page)).document) === JSON.stringify(s.doc)) return s;
    assert.ok(Date.now() < end, `timed out waiting for ${what} to be saved`);
    await page.waitForTimeout(250);
  }
}

/** Clicks an export button and returns the download's name and bytes. */
export async function download(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click(selector)]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(readFileSync(await dl.path())) };
}
/** Width and height from a PNG's IHDR. */
export function pngSize(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'a PNG');
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  return [v.getUint32(16), v.getUint32(20)];
}
export const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');
