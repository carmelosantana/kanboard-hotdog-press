// Task 1 browser spike E2E against kb-suite on :8081 (admin/admin). Resolves playwright through the harness-root
// node_modules symlink. Run from the harness root: node HotDogPress/Test/e2e/spike.mjs
import { chromium } from 'playwright';

const BASE = process.env.KB_BASE || 'http://localhost:8081';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e)));

let failures = 0;
const step = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

try {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin');
    await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form button[type="submit"]')]);

    const res = await page.goto(`${BASE}/hotdogpress/spike`);
    step('spike page status', res.status() === 200, String(res.status()));
    await page.waitForFunction(() => [...document.querySelectorAll('#hdp-spike li')].every((li) => li.dataset.result), null, { timeout: 10000 })
        .catch(() => {});
    for (const li of await page.locator('#hdp-spike li').all()) {
        const text = await li.textContent();
        step(`spike ${await li.getAttribute('data-step')}`, (await li.getAttribute('data-result')) === 'ok', text);
    }
    const link = page.locator('#hdp-spike-download');
    if (await link.count()) {
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), link.click()]);
        const path = await download.path();
        const { readFile } = await import('node:fs/promises');
        const body = await readFile(path, 'utf8');
        step('download saved', download.suggestedFilename() === 'hotdogpress-spike.txt' && body === 'Hot Dog Press spike\n',
            `${download.suggestedFilename()} ${JSON.stringify(body)}`);
    }

    await page.goto(`${BASE}/?controller=PluginController&action=show`);
    step('plugin list shows HotDogPress', (await page.getByText('HotDogPress', { exact: false }).count()) > 0);
} catch (e) {
    step('run', false, String(e));
} finally {
    console.log(`console errors (${consoleErrors.length}):`);
    for (const e of consoleErrors) console.log('  ' + e);
    await browser.close();
}
process.exit(failures ? 1 : 0);
