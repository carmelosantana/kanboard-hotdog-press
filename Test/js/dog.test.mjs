// The Dog: newDog, migrateDog and validateDog, driven by the fixtures the PHP validator test shares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  newDog, migrateDog, validateDog, FIELDS, LAYOUT_NAMES, ITEM_TYPES, BY_VALUES, PAPER_IDS, MAX_DOG_BYTES,
} from '../../Assets/js/core/dog.js';

const DIR = new URL('../fixtures/dog/', import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, DIR), 'utf8'));
const fixtures = (prefix) => readdirSync(DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort();

test('the fixture directory has valid and invalid fixtures', () => {
  assert.ok(fixtures('valid-').length >= 2);
  assert.ok(fixtures('invalid-').length >= 15);
});

for (const name of fixtures('valid-')) {
  test(`${name} is valid in both modes`, () => {
    for (const mode of ['lenient', 'strict']) {
      const res = validateDog(load(name), { mode });
      assert.deepEqual(res.errors ?? [], [], mode);
      assert.equal(res.ok, true, mode);
      assert.equal(res.dog.hotdog, 1, mode);
    }
  });
}

for (const name of fixtures('invalid-')) {
  test(`${name} reports exactly its errors`, () => {
    const { mode, errors, dog } = load(name);
    const res = validateDog(dog, { mode });
    assert.equal(res.ok, false);
    assert.deepEqual(res.errors, errors);
    if (mode === 'lenient') {
      // Strict adds nothing for a fixture with no unknown fields.
      assert.deepEqual(validateDog(dog, { mode: 'strict' }).errors, errors);
    } else {
      // A strict-only failure loads in lenient mode with the unknown fields kept.
      const lenient = validateDog(dog, { mode: 'lenient' });
      assert.equal(lenient.ok, true);
      assert.deepEqual(lenient.dog, dog);
    }
  });
}

test('the field lists and enums match the shared fields.json', () => {
  const shared = load('fields.json');
  assert.deepEqual(
    { ...FIELDS, papers: PAPER_IDS, layouts: LAYOUT_NAMES, by: BY_VALUES },
    shared,
  );
  assert.deepEqual(ITEM_TYPES, Object.keys(shared.types));
});

test('LAYOUT_NAMES is the nine layouts, frozen', () => {
  assert.deepEqual(LAYOUT_NAMES, [
    'cover', 'back-cover', 'headline-body', 'photo-full', 'photo-caption', 'list', 'quote', 'two-up', 'freeform',
  ]);
  assert.ok(Object.isFrozen(LAYOUT_NAMES));
});

test('newDog makes a strictly valid Dog 1 with eight empty freeform pages', () => {
  const dog = newDog({ title: 'Plant Medicine', paper: 'a4' });
  assert.deepEqual(validateDog(dog, { mode: 'strict' }), { ok: true, dog });
  assert.equal(dog.hotdog, 1);
  assert.equal(dog.title, 'Plant Medicine');
  assert.equal(dog.paper, 'a4');
  assert.equal(dog.margin_mm, 6);
  assert.equal(dog.look, 'kraft');
  assert.deepEqual(dog.assets, {});
  assert.deepEqual(dog.pages, Array.from({ length: 8 }, (_, i) => ({
    id: `p${i + 1}`, layout: 'freeform', bg: 'paper', items: [],
  })));
  assert.match(dog.id, /^z_[0-9a-z]{8}$/);
  assert.notEqual(newDog({ title: 'x', paper: 'a4' }).id, dog.id);
});

test('newDog rejects an unknown paper', () => {
  assert.throws(() => newDog({ title: 'x', paper: 'a5' }), /Unknown paper/);
});

test('migrateDog treats a missing hotdog as 0 and brings it to 1 without touching the input', () => {
  const old = load('valid-legacy-no-version.json');
  const migrated = migrateDog(old);
  assert.equal(migrated.hotdog, 1);
  assert.equal('hotdog' in old, false);
  assert.deepEqual({ ...migrated, hotdog: undefined }, { ...old, hotdog: undefined });
  assert.equal(migrateDog({ ...old, hotdog: 0 }).hotdog, 1);
  assert.equal(migrateDog({ ...old, hotdog: 7 }).hotdog, 7);
});

test('validateDog accepts JSON text and reports text that does not parse', () => {
  const text = readFileSync(new URL('valid-minimal.json', DIR), 'utf8');
  assert.equal(validateDog(text, { mode: 'strict' }).ok, true);
  assert.deepEqual(validateDog('{nope', { mode: 'lenient' }), {
    ok: false, errors: [{ path: '', message: 'must be valid JSON' }],
  });
});

test('validateDog rejects a root that is not an object', () => {
  for (const bad of [null, 5, [], 'null']) {
    assert.deepEqual(validateDog(bad, { mode: 'lenient' }).errors, [{ path: '', message: 'must be an object' }]);
  }
});

test('the whole Dog is at most 2 MB of JSON', () => {
  assert.equal(MAX_DOG_BYTES, 2 * 1024 * 1024);
  const dog = load('valid-minimal.json');
  const overhead = new TextEncoder().encode(JSON.stringify({ ...dog, title: '' })).length;
  // 'é' is two bytes in UTF-8: byte length, not string length, is what counts.
  const fits = { ...dog, title: 'a'.repeat(MAX_DOG_BYTES - overhead) };
  assert.equal(validateDog(fits, { mode: 'strict' }).ok, true);
  const over = { ...dog, title: 'é'.repeat((MAX_DOG_BYTES - overhead) / 2 + 1) };
  assert.deepEqual(validateDog(over, { mode: 'strict' }).errors, [
    { path: '', message: 'must be at most 2097152 bytes of JSON' },
  ]);
});

test('the error path escapes ~ and / in asset ids like a JSON pointer', () => {
  const dog = load('valid-minimal.json');
  dog.assets = { 'a/1~': { kind: 'image', file_id: 1, w: 1, h: 1, extra: 1 } };
  assert.deepEqual(validateDog(dog, { mode: 'strict' }).errors, [{ path: 'assets/a~11~0/extra', message: 'unknown field' }]);
});

test('a Dog that JSON cannot encode (a cycle, a BigInt) is an error, not a throw', () => {
  const cyclic = load('valid-minimal.json');
  cyclic.pages[0].self = cyclic;
  const big = { ...load('valid-minimal.json'), margin_mm: 6n };
  for (const dog of [cyclic, big]) {
    assert.deepEqual(validateDog(dog, { mode: 'lenient' }), {
      ok: false, errors: [{ path: '', message: 'must be valid JSON' }],
    });
  }
});
