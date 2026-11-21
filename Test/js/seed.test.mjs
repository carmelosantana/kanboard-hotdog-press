// The Plant Medicine seed against a fake JSON-RPC: idempotent, closed page tasks included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedPlantMedicine, PAGES, taskTitle, VIEWER } from '../tools/seed-plant-medicine.mjs';

/** A fake Kanboard holding the sample project, its tasks ({title, open}) and the viewer; logs every call. */
function fakeKanboard(tasks) {
  const calls = [];
  const call = async (method, params = {}) => {
    calls.push([method, params]);
    switch (method) {
      case 'getProjectByIdentifier': return { id: 7 };
      case 'getAllTasks': return tasks.filter((t) => (params.status_id === 1) === t.open).map((t) => ({ title: t.title }));
      case 'getUserByName': return { id: 9, username: VIEWER };
      case 'getProjectUserRole': return 'project-viewer';
      case 'createTask': return 100 + calls.length;
      default: throw new Error(`unexpected ${method}`);
    }
  };
  return { call, calls };
}
const titles = PAGES.map(([layout], i) => taskTitle(i + 1, layout));

test('a seeded project changes nothing, even when some page tasks are closed', async () => {
  const kb = fakeKanboard(titles.map((title, i) => ({ title, open: i % 2 === 0 })));
  const out = await seedPlantMedicine(kb.call, 'pw');
  assert.deepEqual(out, { project_id: 7, viewer_id: 9, changes: [] });
  assert.equal(kb.calls.filter(([m]) => m === 'createTask').length, 0);
});

test('a missing page task is created once', async () => {
  const kb = fakeKanboard(titles.slice(1).map((title) => ({ title, open: false })));
  const out = await seedPlantMedicine(kb.call, 'pw');
  assert.deepEqual(kb.calls.filter(([m]) => m === 'createTask').map(([, p]) => p.title), [titles[0]]);
  assert.equal(out.changes.length, 1);
});
