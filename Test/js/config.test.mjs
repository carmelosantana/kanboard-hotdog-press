// The editor's boot config: parsing the JSON block the editor template writes, and filling its strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, imageUrl, fill } from '../../Assets/js/app/config.js';

const good = {
  routes: { load: '/l', save: '/s', upload: '/u', image: '/z/1/image/{file_id}', export: '/e', list: '/list' },
  csrf_token: 'tok',
  zine_id: 1,
  project_id: 2,
  revision: 3,
  can_edit: true,
  paper: 'letter',
  user_lang: 'en_US',
  strings: { loading: 'Loading…', print_note: 'Print at Actual size (100%), on %s, one side.' },
};

test('readConfig returns the parsed config', () => {
  assert.deepEqual(readConfig(JSON.stringify(good)), good);
});

test('readConfig rejects text that is not JSON, or a config missing a field', () => {
  assert.throws(() => readConfig('nope'), /config/);
  assert.throws(() => readConfig('[]'), /config/);
  for (const key of Object.keys(good)) {
    const { [key]: _, ...rest } = good;
    assert.throws(() => readConfig(JSON.stringify(rest)), new RegExp(key), key);
  }
  for (const key of Object.keys(good.routes)) {
    const { [key]: _, ...routes } = good.routes;
    assert.throws(() => readConfig(JSON.stringify({ ...good, routes })), new RegExp(key), key);
  }
});

test('imageUrl fills the file id into the pattern', () => {
  assert.equal(imageUrl(good, 42), '/z/1/image/42');
});

test('fill replaces each %s in order and leaves a literal % alone', () => {
  assert.equal(fill(good.strings.print_note, 'Letter'), 'Print at Actual size (100%), on Letter, one side.');
  assert.equal(fill('%s of %s', 1, 8), '1 of 8');
  assert.equal(fill('no args'), 'no args');
});
