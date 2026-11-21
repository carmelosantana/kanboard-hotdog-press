// The autosave client: a 2 s debounce, a sessionStorage buffer until the server acknowledges, sendBeacon on
// pagehide, and the 409 conflict prompt. Driven with fake timers, a fake fetch and an in-memory storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOSAVE_DELAY_MS, RETRY_MS, RETRY_MAX_MS, TERMINAL_STATUS, bufferKey, createAutosave, recoverBuffer,
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
      redirect: init.redirect,
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
  assert.deepEqual(t.states, ['saved', 'dirty', 'dirty', 'saving', 'saved'], 'a clean zine starts saved');
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

test('a beacon sent when the tab was hidden, then more edits: the 409 against the beaconed copy is re-sent, not a conflict', async () => {
  let server = { revision: 3, text: null };
  const t = setup({
    reply: (req) => {
      if (req.method === 'GET') return json(200, { revision: server.revision, document: JSON.parse(server.text) });
      if (req.revision !== String(server.revision)) return json(409, { error: 'conflict', revision: server.revision });
      server = { revision: server.revision + 1, text: req.document };
      return json(200, { ok: true, revision: server.revision });
    },
  });
  t.store.update((d) => titled(d, 'b'));
  t.autosave.pagehide();
  t.autosave.pagehide();
  assert.equal(t.beacons.length, 1, 'the same copy is beaconed once');
  // The beacon lands on the server.
  server = { revision: 4, text: t.beacons[0].body.get('document') };
  t.store.update((d) => titled(d, 'c'));
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  assert.deepEqual(t.conflicts, []);
  assert.deepEqual(t.server.requests.filter((r) => r.method === 'POST').map((r) => r.revision), ['3', '4']);
  assert.equal(JSON.parse(server.text).title, 'c');
  assert.equal(t.config.revision, 5);
  assert.equal(t.states.at(-1), 'saved');
});

test('a tab closed while a save is in flight beacons that copy (the request may be cancelled on unload)', async () => {
  let release;
  const t = setup({ reply: () => new Promise((r) => { release = () => r(json(200, { ok: true, revision: 4 })); }) });
  t.store.update((d) => titled(d, 'b'));
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  assert.equal(t.server.requests.length, 1, 'in flight');
  t.autosave.pagehide();
  assert.equal(t.beacons.length, 1, 'sent but not acknowledged still goes out');
  assert.deepEqual([t.beacons[0].body.get('revision'), t.beacons[0].body.get('document')], ['3', JSON.stringify(t.store.doc)]);
  release();
  await settle();
  t.autosave.pagehide();
  assert.equal(t.beacons.length, 1, 'nothing once acknowledged');
});

test('saved() sends what is unsaved now, waits for the request in flight and the one after it', async () => {
  const t = setup();
  t.store.update((d) => titled(d, 'b'));
  await t.autosave.saved();
  assert.deepEqual(t.server.requests.map((r) => JSON.parse(r.document).title), ['b'], 'no 2 s wait');
  assert.equal(t.states.at(-1), 'saved');
  await t.autosave.saved();
  assert.equal(t.server.requests.length, 1, 'nothing to send');
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

// Errors a retry cannot fix: the session ended (401, 403, or a redirect to the login page), the zine was removed
// (404), the request or zine is refused (400, 413, 422), or the answer is not JSON. Saving stops, the buffer stays for a reload, and the line
// says so; nothing is retried.
const TERMINAL = {
  400: () => json(400, { error: 'bad_request' }),
  401: () => json(401, { error: 'unauthorized' }),
  403: () => json(403, { error: 'forbidden' }),
  404: () => json(404, { error: 'not_found' }),
  413: () => json(413, { error: 'too_large' }),
  422: () => json(422, { error: 'invalid', errors: [] }),
  'a redirect (manual)': () => ({ ok: false, status: 0, type: 'opaqueredirect', json: async () => { throw new SyntaxError('opaque'); } }),
  'a login page (200, not JSON)': () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }),
};
test('the terminal statuses', () => assert.deepEqual(TERMINAL_STATUS, [400, 401, 403, 404, 413, 422]));
for (const [name, reply] of Object.entries(TERMINAL)) {
  test(`${name} stops saving, keeps the buffer and is not retried`, async () => {
    const t = setup({ reply });
    t.store.update((d) => titled(d, 'b'));
    await t.timers.advance(AUTOSAVE_DELAY_MS);
    assert.equal(t.states.at(-1), 'stopped');
    assert.equal(buffered(t.storage).doc.title, 'b', 'the edit stays in this tab');
    await t.timers.advance(RETRY_MAX_MS * 4);
    assert.equal(t.server.requests.length, 1, 'no retry');
    t.store.update((d) => titled(d, 'c'));
    assert.equal(buffered(t.storage).doc.title, 'c', 'later edits are buffered too');
    assert.equal(t.states.at(-1), 'stopped');
    await t.timers.advance(AUTOSAVE_DELAY_MS * 3);
    await t.autosave.saved();
    t.autosave.pagehide();
    assert.equal(t.server.requests.length, 1, 'nothing more is sent');
    assert.equal(t.beacons.length, 0, 'no beacon either: it would fail the same way');
  });
}

test('saves and the conflict check never follow a redirect (a login page would look like a 200)', async () => {
  const t = setup({
    reply: (req) => (req.method === 'GET' ? json(200, { revision: 9, document: newDog() }) : json(409, { error: 'conflict', revision: 9 })),
  });
  t.store.update((d) => titled(d, 'b'));
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  assert.deepEqual(t.server.requests.map((r) => [r.method, r.redirect]), [['POST', 'manual'], ['GET', 'manual']]);
});

test('a server error (5xx) is retried with backoff', async () => {
  let fail = true;
  let rev = 3;
  const t = setup({ reply: () => (fail ? { ok: false, status: 502, json: async () => { throw new SyntaxError('<html>'); } } : json(200, { ok: true, revision: ++rev })) });
  t.store.update((d) => titled(d, 'b'));
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  assert.equal(t.states.at(-1), 'error');
  await t.timers.advance(RETRY_MS);
  assert.equal(t.server.requests.length, 2, 'retried after RETRY_MS');
  await t.timers.advance(RETRY_MS * 2);
  assert.equal(t.server.requests.length, 3, 'then after twice as long');
  fail = false;
  await t.timers.advance(RETRY_MS * 4);
  assert.equal(t.states.at(-1), 'saved');
});

test('saved() waits for the request in flight, then sends the edit made meanwhile', async () => {
  const releases = [];
  let rev = 3;
  const t = setup({ reply: () => new Promise((r) => { releases.push(() => r(json(200, { ok: true, revision: ++rev }))); }) });
  t.store.update((d) => titled(d, 'b'));
  await t.timers.advance(AUTOSAVE_DELAY_MS);
  t.store.update((d) => titled(d, 'c'));
  let done = false;
  const waiting = t.autosave.saved().then(() => { done = true; });
  await settle();
  releases.shift()();
  await settle();
  assert.equal(done, false, 'the edit made meanwhile is not on the server yet');
  assert.equal(t.server.requests.length, 2);
  releases.shift()();
  await waiting;
  assert.deepEqual(t.server.requests.map((r) => JSON.parse(r.document).title), ['b', 'c']);
  assert.equal(t.autosave.dirty, false);
});

test('saved() ends at a conflict without saving over it', async () => {
  const t = setup({
    reply: (req) => (req.method === 'GET'
      ? json(200, { revision: 9, document: titled(newDog(), 'theirs') })
      : json(409, { error: 'conflict', revision: 9 })),
  });
  t.store.update((d) => titled(d, 'mine'));
  await t.autosave.saved();
  assert.equal(t.states.at(-1), 'conflict');
  assert.equal(t.autosave.dirty, true);
  assert.equal(t.server.requests.filter((r) => r.method === 'POST').length, 1);
});

test('saved() gives up after three tries when the save keeps failing', async () => {
  const t = setup({ reply: () => Promise.reject(new TypeError('offline')) });
  t.store.update((d) => titled(d, 'b'));
  await t.autosave.saved();
  assert.equal(t.server.requests.length, 3);
  assert.equal(t.autosave.dirty, true, 'still unsaved: the caller can tell');
  assert.equal(t.states.at(-1), 'error');
});
