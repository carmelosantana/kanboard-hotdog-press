// Shared pieces of the editor E2E runs on the :8081 dev stack: the localhost guard, PDO inside kb-suite (dev only;
// never the production MCP), a watcher for console errors, page errors, failed responses, CSP violations and other
// origins, login, the editor's live state, and making and removing a zine.
import { execFileSync } from 'node:child_process';
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
 * @param {{expect?: (r: any) => boolean}} [opts] `expect` marks a response the run causes on purpose (a 409)
 */
export function watch(page, label, { expect = () => false } = {}) {
  page.on('console', (m) => { if (m.type() === 'error' && !/the server responded with a status of 409/.test(m.text())) problems.push(`${label} console: ${m.text()}`); });
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
export async function createZine(page, title) {
  await page.goto(`${BASE}/hotdogpress/project/${PROJECT_ID}`);
  await page.fill('form[action*="/create"] input[name=title]', title);
  await Promise.all([
    page.waitForURL(/\/hotdogpress\/zine\/\d+$/),
    page.locator('form[action*="/create"] [type=submit]').click(),
  ]);
  await page.waitForSelector('#hotdogpress-app[data-ready="true"]');
  return Number(/zine\/(\d+)/.exec(page.url())[1]);
}

/** Removes a zine and its project files (uploaded photos and saved PDFs are named hotdogpress-<id>-…). */
export function removeZine(zineId) {
  php(`
    $files = $db->prepare("SELECT path FROM project_has_files WHERE project_id = ? AND name LIKE ?");
    $files->execute([${PROJECT_ID}, "hotdogpress-" . $argv[1] . "-%"]);
    foreach ($files->fetchAll(PDO::FETCH_COLUMN) as $p) { @unlink("/var/www/app/data/files/" . $p); @unlink("/var/www/app/data/files/" . $p . ".thumb"); }
    $db->prepare("DELETE FROM project_has_files WHERE project_id = ? AND name LIKE ?")->execute([${PROJECT_ID}, "hotdogpress-" . $argv[1] . "-%"]);
    $db->prepare("DELETE FROM hotdogpress_zines WHERE id = ?")->execute([$argv[1]]);`, String(zineId));
}
