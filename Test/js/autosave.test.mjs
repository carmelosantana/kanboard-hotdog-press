// The autosave client: a 2 s debounce, a sessionStorage buffer until the server acknowledges, sendBeacon on
// pagehide, and the 409 conflict prompt. Driven with fake timers, a fake fetch and an in-memory storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOSAVE_DELAY_MS, RETRY_MS, bufferKey, createAutosave, recoverBuffer,
} from '../../Assets/js/app/autosave.js';
import { createStore } from '../../Assets/js/app/store.js';
import { newDog } from '../../Assets/js/core/dog.js';

const titled = (doc, title) => ({ ...doc, title });

function memoryStorage() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

function fakeTimers() {
  let now = 0;
  let next = 1;
  const queue = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; queue.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { queue.delete(id); },
    /** Runs every timer due within `ms`, in time order. */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...queue.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        queue.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await settle();
      }
      now = end;
    },
    get pending() { return queue.size; },
  };
}

const settle = () => new Promise((r) => setImmediate(r));
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fake server: records requests; `reply(req)` answers each. */
function fakeFetch(reply) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    const form = init.body;
    const req = {
      url,
      method: init.method ?? 'GET',
      csrf: form?.get?.('csrf_token'),
      revision: form?.get?.('revision'),
      document: form?.get?.('document'),
    };
    requests.push(req);
    return reply(req);
  };
  return { fetch, requests };
}

function setup({ reply, revision = 3, dirty } = {}) {
  const store = createStore(newDog({ title: 'a' }));
  const config = { zine_id: 7, revision, csrf_token: 'tok', routes: { save: '/save', load: '/load' } };
  const storage = memoryStorage();
  const timers = fakeTimers();
  let rev = revision;
  const server = fakeFetch(reply ?? ((req) => (req.method === 'POST' ? json(200, { ok: true, revision: ++rev }) : json(404, {}))));
  const beacons = [];
  const states = [];
  const conflicts = [];
  const autosave = createAutosave({
    store,
    config,
    env: {
      fetch: server.fetch,
      storage,
      sendBeacon: (url, body) => { beacons.push({ url, body }); return true; },
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
    onState: (s) => states.push(s),
    onConflict: (c) => conflicts.push(c),
    dirty,
  });
  return { store, config, storage, timers, server, beacons, states, conflicts, autosave };
}

const buffered = (storage) => JSON.parse(storage.getItem(bufferKey(7)));

test('edits are buffered at once and saved once, 2 s after the last one, with the revision', async () => {
  const t = setup();
  assert.equal(AUTOSAVE_DELAY_MS, 2000);
  t.store.update((d) => titled(d, 'b'));
  assert.deepEqual(buffered(t.storage), { revision: 3, doc: t.store.doc }, 'buffered before any request');
  await t.timers.advance(1500);
  t.store.update((d) => titled(d, 'c'));
  await t.timers.advance(1999);
  assert.equal(t.server.requests.length, 0, 'the debounce restarts on each edit');
  await t.timers.advance(1);
  assert.equal(t.server.requests.length, 1);
  const [req] = t.server.requests;
  assert.deepEqual([req.url, req.method, req.csrf, req.revision], ['/save', 'POST', 'tok', '3']);
  assert.equal(req.document, JSON.stringify(t.store.doc));
  assert.equal(t.config.revision, 4, 'the new revision is kept for the next save');
  assert.equal(t.storage.getItem(bufferKey(7)), null, 'the buffer goes once the server has it');
  assert.deepEqual(t.states, ['dirty', 'dirty', 'saving', 'saved']);
});

test('an edit made while a save is in flight is saved next, on the new revision', async () => {
  let release;
  let rev = 3;
  const t = setup({ reply: (req) => new Promise((r) => { release = () => r(json(200, { ok: true, revision: ++rev })); }) });
  t.store.update((d) => titled(d, 'b'));
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  t.store.update((d) => titled(d, 'c'));
  release();
  await settle();
  assert.deepEqual(buffered(t.storage), { revision: 4, doc: t.store.doc }, 'still buffered, on the new revision');
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  release();
  await settle();
  assert.deepEqual(t.server.requests.map((r) => [r.revision, JSON.parse(r.document).title]), [['3', 'b'], ['4', 'c']]);
  assert.equal(t.storage.getItem(bufferKey(7)), null);
});

test('a 409 with other content opens the prompt and stops saving; Keep mine saves on the server revision', async () => {
  let accept = false;
  const t = setup({
    reply: (req) => {
      if (req.method === 'GET') return json(200, { revision: 9, document: titled(newDog(), 'theirs') });
      return accept ? json(200, { ok: true, revision: 10 }) : json(409, { error: 'conflict', revision: 9 });
    },
  });
  t.store.update((d) => titled(d, 'mine'));
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  assert.deepEqual(t.conflicts, [{ revision: 9 }]);
  assert.equal(t.states.at(-1), 'conflict');
  assert.equal(buffered(t.storage).doc.title, 'mine', 'my edit stays buffered');
  t.store.update((d) => titled(d, 'mine 2'));
  await t.timers.advance(AUTOSAVE_DELAY_MS * 3);
  assert.equal(t.server.requests.filter((r) => r.method === 'POST').length, 1, 'no saves while the prompt is open');
  accept = true;
  await t.autosave.keepMine(9);
  const last = t.server.requests.at(-1);
  assert.deepEqual([last.method, last.revision, JSON.parse(last.document).title], ['POST', '9', 'mine 2']);
  assert.equal(t.config.revision, 10);
  assert.equal(t.storage.getItem(bufferKey(7)), null);
});

test('a 409 whose server copy is exactly what was sent (a pagehide beacon landed first) is not a conflict', async () => {
  let sent;
  const t = setup({
    reply: (req) => {
      if (req.method === 'POST') { sent = req.document; return json(409, { error: 'conflict', revision: 4 }); }
      return json(200, { revision: 4, document: JSON.parse(sent) });
    },
  });
  t.store.update((d) => titled(d, 'b'));
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  assert.deepEqual(t.conflicts, []);
  assert.equal(t.config.revision, 4);
  assert.equal(t.states.at(-1), 'saved');
  assert.equal(t.storage.getItem(bufferKey(7)), null);
});

test('a failed save shows the error, keeps the buffer and retries', async () => {
  let fail = true;
  let rev = 3;
  const t = setup({ reply: () => (fail ? Promise.reject(new TypeError('offline')) : json(200, { ok: true, revision: ++rev })) });
  t.store.update((d) => titled(d, 'b'));
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  assert.equal(t.states.at(-1), 'error');
  assert.equal(buffered(t.storage).doc.title, 'b');
  fail = false;
  await t.timers.advance(RETRY_MS);
  assert.equal(t.server.requests.length, 2);
  assert.equal(t.states.at(-1), 'saved');
  assert.equal(t.storage.getItem(bufferKey(7)), null);
});

test('pagehide sends unsaved edits with sendBeacon, and nothing when all is saved', async () => {
  const t = setup();
  t.autosave.pagehide();
  assert.equal(t.beacons.length, 0, 'nothing to send');
  t.store.update((d) => titled(d, 'b'));
  t.autosave.pagehide();
  assert.equal(t.beacons.length, 1);
  const { url, body } = t.beacons[0];
  assert.deepEqual([url, body.get('csrf_token'), body.get('revision'), body.get('document')], ['/save', 'tok', '3', JSON.stringify(t.store.doc)]);
  assert.equal(buffered(t.storage).doc.title, 'b', 'the buffer stays until a load sees the change');
});

test('discard drops the buffer and stops saving (before a reload)', async () => {
  const t = setup();
  t.store.update((d) => titled(d, 'b'));
  t.autosave.discard();
  assert.equal(t.storage.getItem(bufferKey(7)), null);
  t.store.update((d) => titled(d, 'c'));
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  assert.equal(t.server.requests.length, 0);
  assert.equal(t.storage.getItem(bufferKey(7)), null);
});

test('a storage that throws (private mode, full) does not stop saving', async () => {
  const t = setup();
  t.storage.setItem = () => { throw new Error('QuotaExceededError'); };
  t.store.update((d) => titled(d, 'b'));
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  assert.equal(t.states.at(-1), 'saved');
});

test('a zine recovered from the buffer (dirty) is saved without waiting for an edit', async () => {
  const t = setup({ dirty: true });
  assert.equal(buffered(t.storage).doc.title, 'a', 'buffered again until the server has it');
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  assert.deepEqual(t.server.requests.map((r) => [r.revision, JSON.parse(r.document).title]), [['3', 'a']]);
  assert.equal(t.storage.getItem(bufferKey(7)), null);
});

test('recoverBuffer: none, already saved, unsaved, unreadable', () => {
  const storage = memoryStorage();
  const loaded = { doc: newDog({ title: 'server' }), revision: 5 };
  assert.deepEqual(recoverBuffer(storage, 7, loaded), { ...loaded, dirty: false }, 'no buffer');

  storage.setItem(bufferKey(7), JSON.stringify({ revision: 4, doc: loaded.doc }));
  assert.deepEqual(recoverBuffer(storage, 7, loaded), { ...loaded, dirty: false }, 'the server has it (a beacon landed)');
  assert.equal(storage.getItem(bufferKey(7)), null);

  const mine = newDog({ title: 'mine' });
  storage.setItem(bufferKey(7), JSON.stringify({ revision: 5, doc: mine }));
  storage.setItem(bufferKey(8), 'other zine');
  assert.deepEqual(recoverBuffer(storage, 7, loaded), { doc: mine, revision: 5, dirty: true }, 'unsaved edits come back');
  storage.setItem(bufferKey(7), JSON.stringify({ revision: 2, doc: mine }));
  assert.deepEqual(recoverBuffer(storage, 7, loaded), { doc: mine, revision: 2, dirty: true },
    'on its old revision, so a save meets the newer server copy as a 409');
  assert.equal(storage.getItem(bufferKey(8)), 'other zine');

  for (const bad of ['{', '{"revision":"x","doc":{}}', JSON.stringify({ revision: 5, doc: { hotdog: 1 } })]) {
    storage.setItem(bufferKey(7), bad);
    assert.deepEqual(recoverBuffer(storage, 7, loaded), { ...loaded, dirty: false }, bad);
    assert.equal(storage.getItem(bufferKey(7)), null, `dropped: ${bad}`);
  }
  assert.deepEqual(recoverBuffer({ getItem: () => { throw new Error('denied'); } }, 7, loaded), { ...loaded, dirty: false });
});
