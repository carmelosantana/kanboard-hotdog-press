// The editor's document store: one Dog, immutable snapshots, undo/redo, change events, selection and the current page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, HISTORY_LIMIT } from '../../Assets/js/app/store.js';
import { newDog } from '../../Assets/js/core/dog.js';

const titled = (doc, title) => ({ ...doc, title });

test('update replaces the document, emits a change, and undo/redo walk the history', () => {
  const store = createStore(newDog({ title: 'a' }));
  const seen = [];
  store.on('change', (e) => seen.push([e.doc.title, e.reason]));
  store.update((d) => titled(d, 'b'));
  store.update((d) => titled(d, 'c'));
  assert.equal(store.doc.title, 'c');
  assert.ok(store.canUndo);
  store.undo();
  assert.equal(store.doc.title, 'b');
  store.undo();
  assert.equal(store.doc.title, 'a');
  assert.equal(store.canUndo, false);
  store.redo();
  assert.equal(store.doc.title, 'b');
  assert.deepEqual(seen.map((s) => s[0]), ['b', 'c', 'b', 'a', 'b']);
  assert.deepEqual(seen.map((s) => s[1]), ['edit', 'edit', 'undo', 'undo', 'redo']);
});

test('the document is frozen, so a stored snapshot can never be changed in place', () => {
  const store = createStore(newDog());
  assert.throws(() => { store.doc.pages[0].items.push({}); }, TypeError);
  const before = store.doc;
  store.update((d) => titled(d, 'x'));
  assert.notEqual(store.doc, before);
  assert.equal(before.title, '');
});

test('a new edit after undo drops the redo branch', () => {
  const store = createStore(newDog({ title: 'a' }));
  store.update((d) => titled(d, 'b'));
  store.undo();
  store.update((d) => titled(d, 'z'));
  assert.equal(store.canRedo, false);
  store.redo();
  assert.equal(store.doc.title, 'z');
});

test('edits with the same merge key become one undo step (a drag is one step)', () => {
  const store = createStore(newDog({ title: 'a' }));
  store.update((d) => titled(d, 'b'), { merge: 'drag:1' });
  store.update((d) => titled(d, 'c'), { merge: 'drag:1' });
  store.update((d) => titled(d, 'd'), { merge: 'drag:1' });
  store.update((d) => titled(d, 'e'), { merge: 'drag:2' });
  store.seal();
  store.update((d) => titled(d, 'f'), { merge: 'drag:2' });
  store.undo();
  assert.equal(store.doc.title, 'e');
  store.undo();
  assert.equal(store.doc.title, 'd');
  store.undo();
  assert.equal(store.doc.title, 'a');
});

test('history keeps at least 50 steps and drops the oldest past its limit', () => {
  assert.ok(HISTORY_LIMIT >= 50);
  const store = createStore(newDog({ title: '0' }));
  for (let i = 1; i <= HISTORY_LIMIT + 5; i++) store.update((d) => titled(d, String(i)));
  let steps = 0;
  while (store.canUndo) { store.undo(); steps++; }
  assert.equal(steps, HISTORY_LIMIT);
  assert.equal(store.doc.title, '5');
});

test('an update that returns the same document is not a step and emits nothing', () => {
  const store = createStore(newDog());
  let n = 0;
  store.on('change', () => n++);
  store.update((d) => d);
  assert.equal(n, 0);
  assert.equal(store.canUndo, false);
});

test('replace swaps the document without history (load, conflict reload)', () => {
  const store = createStore(newDog({ title: 'a' }));
  store.update((d) => titled(d, 'b'));
  const reasons = [];
  store.on('change', (e) => reasons.push(e.reason));
  store.replace(newDog({ title: 'fresh' }));
  assert.equal(store.doc.title, 'fresh');
  assert.equal(store.canUndo, false);
  assert.deepEqual(reasons, ['replace']);
});

test('selection and the current page emit their own events, and selection drops ids that are gone', () => {
  const dog = newDog();
  dog.pages[0].items = [{ id: 'k', type: 'shape', by: 'hand', x: 0, y: 0, w: 0.1, h: 0.1 }];
  const store = createStore(dog);
  const events = [];
  store.on('select', (e) => events.push(['select', e.selection]));
  store.on('page', (e) => events.push(['page', e.page]));
  store.select(['k']);
  store.setPage(3);
  assert.deepEqual(store.selection, ['k']);
  assert.equal(store.page, 3);
  store.setPage(99);
  assert.equal(store.page, 7);
  store.update((d) => ({ ...d, pages: d.pages.map((p) => ({ ...p, items: [] })) }));
  assert.deepEqual(store.selection, []);
  assert.deepEqual(events, [['select', ['k']], ['page', 3], ['page', 7], ['select', []]]);
});

test('off removes a listener', () => {
  const store = createStore(newDog());
  let n = 0;
  const fn = () => n++;
  store.on('change', fn);
  store.off('change', fn);
  store.update((d) => titled(d, 'x'));
  assert.equal(n, 0);
});
