// Seeds the "Plant Medicine (sample)" project on the :8081 dev stack over JSON-RPC (zero dependencies): the eight
// page-plan tasks from docs/superpowers/plans/hotdogpress-plant-medicine.md and a `zine-viewer` user with the project
// viewer role. Never production: the URL must be a localhost dev stack.
//
// Idempotent: the project is found by its identifier (PMSAMPLE); anything already there is left alone, only what is
// missing is added, and a run that finds everything in place changes nothing and says so.
//
//   node Test/tools/seed-plant-medicine.mjs        # prints a JSON summary: {project_id, viewer_id, changes}
//
// Env: KB_URL (http://localhost:8081), KB_USER / KB_PASSWORD (admin / admin), ZINE_VIEWER_PASSWORD (dev-only
// password for zine-viewer, default below; set only when the user is created).
import { fileURLToPath } from 'node:url';

export const IDENTIFIER = 'PMSAMPLE';
export const PROJECT_NAME = 'Plant Medicine (sample)';
export const VIEWER = 'zine-viewer';
export const VIEWER_PASSWORD_DEFAULT = 'zine-viewer-dev-only';

const DESCRIPTION = 'Hot Dog Press sample (dev stack only). Eight short tasks carry the page plan of the zine '
  + '"Cohoba and the questions we ask"; the research itself stays on the production board.';

/** The page plan, page by page: [layout, content], text only (hotdogpress-plant-medicine.md, "Draft page plan (A)"). */
export const PAGES = [
  ['cover', 'Medicina de plantas en Puerto Rico — raíces, ancestros, vivir con las plantas (7135, 7099)'],
  ['headline-body', 'Why this zine: island and diaspora evidence, bilingual primary sources (7099)'],
  ['photo-caption', 'Cohoba: an archaeological find, and what is still uncertain about it (7099, 7093)'],
  ['quote', 'Taíno voices are community-led; some testimony is held back on purpose (7098, 7099)'],
  ['headline-body', "Neighbours, not the same: the Haitian diaspora's plant knowledge is kept distinct (7099)"],
  ['list', 'Consent first: free, prior and informed consent, benefit-sharing, source permissions (7094, 7098)'],
  ['headline-body', "What we don't know yet: Afro-Caribbean and contemporary practice, research paused (7099, 7093)"],
  ['back-cover', 'No invented clinical claims. Not medical advice. 8.care, a Field Guide to Care (7259)'],
];
export const taskTitle = (n, layout) => `Page ${n} · ${layout}`;

/** A JSON-RPC client for one Kanboard; throws on transport or RPC errors. */
export function rpc({ url = process.env.KB_URL || 'http://localhost:8081', user = process.env.KB_USER || 'admin',
  password = process.env.KB_PASSWORD || 'admin' } = {}) {
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error(`refusing: KB_URL must be a localhost dev stack, not ${url}`);
  }
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  let id = 0;
  return async (method, params = {}) => {
    const res = await fetch(`${url}/jsonrpc.php`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, id: ++id, params }),
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  };
}

/**
 * Makes sure the sample project, its eight tasks and the viewer exist.
 * @returns {Promise<{project_id: number, viewer_id: number, changes: string[]}>}
 */
export async function seedPlantMedicine(call = rpc(), viewerPassword = process.env.ZINE_VIEWER_PASSWORD || VIEWER_PASSWORD_DEFAULT) {
  const changes = [];
  let project = await call('getProjectByIdentifier', { identifier: IDENTIFIER });
  if (!project) {
    const id = await call('createProject', { name: PROJECT_NAME, identifier: IDENTIFIER, description: DESCRIPTION });
    if (!id) throw new Error('createProject failed');
    project = { id };
    changes.push(`project ${id}`);
  }
  const projectId = Number(project.id);

  const have = new Set((await call('getAllTasks', { project_id: projectId, status_id: 1 })).map((t) => t.title));
  for (const [i, [layout, content]] of PAGES.entries()) {
    const title = taskTitle(i + 1, layout);
    if (have.has(title)) continue;
    const id = await call('createTask', { project_id: projectId, title, description: content });
    if (!id) throw new Error(`createTask ${title} failed`);
    changes.push(`task ${id} ${title}`);
  }

  let viewer = await call('getUserByName', { username: VIEWER });
  if (!viewer) {
    const id = await call('createUser', { username: VIEWER, password: viewerPassword, name: 'Zine viewer', role: 'app-user' });
    if (!id) throw new Error('createUser failed');
    viewer = { id };
    changes.push(`user ${id} ${VIEWER}`);
  }
  const viewerId = Number(viewer.id);
  const role = await call('getProjectUserRole', { project_id: projectId, user_id: viewerId });
  if (role !== 'project-viewer') {
    const ok = role
      ? await call('changeProjectUserRole', { project_id: projectId, user_id: viewerId, role: 'project-viewer' })
      : await call('addProjectUser', { project_id: projectId, user_id: viewerId, role: 'project-viewer' });
    if (!ok) throw new Error('viewer role not set');
    changes.push(`${VIEWER} is project-viewer`);
  }
  return { project_id: projectId, viewer_id: viewerId, changes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const out = await seedPlantMedicine();
    console.error(out.changes.length ? `seeded: ${out.changes.join('; ')}` : 'already seeded: nothing changed');
    console.log(JSON.stringify(out));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
