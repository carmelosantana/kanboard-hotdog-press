// Every UI string the editor config carries (Model/EditorConfig.php strings()) is read by the app, by name or
// through one of the app's name prefixes (`layout_${name}` and the like); an unused one is dead weight in every
// language file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sources } from '../tools/version-imports.mjs';

const php = readFileSync(new URL('../../Model/EditorConfig.php', import.meta.url), 'utf8');
const keys = [...php.slice(php.indexOf('function strings()')).matchAll(/^\s*'([\w-]+)' => e\(/gm)].map((m) => m[1]);
const app = sources().map((f) => readFileSync(f, 'utf8')).join('\n');
/** Prefixes the app builds keys from: strings[`view_${v}`] and the like. */
const prefixes = [...app.matchAll(/strings\[`([\w-]+)\$\{/g)].map((m) => m[1]);

test('every editor string is used by the app', () => {
  assert.ok(keys.length > 80, `found ${keys.length} keys`);
  assert.ok(prefixes.includes('layout_'), 'found the dynamic prefixes');
  const used = (k) => new RegExp(`strings\\.${k}\\b|['"]${k}['"]`).test(app) || prefixes.some((p) => k.startsWith(p));
  assert.deepEqual(keys.filter((k) => !used(k)), []);
});
