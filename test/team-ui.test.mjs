// Spec 040 (revisión visual y galería), T2 y T3 — una spec con interfaz en el equipo (R3–R6): no se entrega sin
// una medición limpia de ESE código, su veredicto exige al diseñador, y el informe dice dónde están las capturas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { commitAll, git, gitRepo, passGate, specFiles, team, writeFiles } from './helpers/teamrepo.mjs';
import { appendEvent, readStatus } from '../catalog/team/lib/ledger.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const A = 'specs/027-checkout';
const P = TEXT.es.problems;
const ROLES = [{ id: 'seguridad', order: 5, cadence: 'task', required: true }, { id: 'revisor', order: 10, cadence: 'task', required: true }];
// Una spec con interfaz, en desarrollo en su worktree.
async function inDev(t, surface = 'ui') {
  const base = await tempDir(t, 'chalc-040-ui-');
  const root = await gitRepo(base, {
    '.chalc/gate.json': JSON.stringify({ language: 'es', spec: { dir: 'specs' }, flow: { roles: ROLES } }), '.gitignore': '.chalc/design-out/\n.chalc/team/\n',
    '.chalc/roles/disenador.md': 'rol\n', '.chalc/roles/revisor.md': 'rol\n', ...specFiles('027-checkout', { touches: ['src/checkout/**'], surface })
  });
  await team(root, 'open', '--feature', 'pagos', A);
  await team(root, 'waves', '--feature', 'pagos');
  assert.equal((await team(root, 'start', '--spec', A)).code, 0);
  const wt = join(base, 'repo.chalc-wt', '027-checkout');
  await writeFiles(wt, { 'src/checkout/pago.tsx': 'export {};\n' });
  commitAll(wt, 'código');
  return { root, wt };
}
// Deja en el worktree una medición de su commit actual.
const measured = (wt, extra = {}) => writeFiles(wt, {
  '.chalc/design-out/measurements.json': JSON.stringify({ commit: git(wt, 'rev-parse', 'HEAD').out, findings: 0, viewports: [], ...extra }), '.chalc/design-out/gallery.html': '<!doctype html>\n'
});
const deliver = (wt) => team(wt, 'deliver', '--spec', A);
const entry = (role, head) => `## 2026-11-22T10:05:00Z · ${head.slice(0, 10)} · ${role} · OK\n\n- nota\n\n`;

test('R3: una spec con interfaz no se entrega sin medición', async (t) => {
  const { wt } = await inDev(t);
  await passGate(wt, A);
  const out = await deliver(wt);
  assert.deepEqual([out.code, out.text.includes(P['ui-not-measured'](A))], [1, true]);
});

test('R3: tampoco con una medición con hallazgos, sin commit o de otro código', async (t) => {
  for (const bad of [{ findings: 2 }, { commit: '' }, { commit: 'deadbeef' }]) {
    const { wt } = await inDev(t);
    await measured(wt, bad);
    await passGate(wt, A);
    assert.equal((await deliver(wt)).text.includes(P['ui-not-measured'](A)), true, JSON.stringify(bad));
  }
  const { wt } = await inDev(t);
  await measured(wt);
  await writeFiles(wt, { 'src/checkout/pago.tsx': 'export const cambiado = 1;\n' });
  commitAll(wt, 'cambio después de medir');
  await passGate(wt, A);
  assert.equal((await deliver(wt)).code, 1, 'código nuevo deja la medición vieja');
});

test('R3: con la medición limpia de ese código, se entrega; y una spec sin interfaz no la necesita', async (t) => {
  const { wt } = await inDev(t);
  await measured(wt);
  await passGate(wt, A);
  const out = await deliver(wt);
  assert.equal(out.code, 0, out.text);
  const plain = await inDev(t, '');
  await passGate(plain.wt, A);
  assert.equal((await deliver(plain.wt)).code, 0);
});

async function delivered(t) {
  const { root, wt } = await inDev(t);
  await measured(wt);
  await passGate(wt, A);
  assert.equal((await deliver(wt)).code, 0);
  return { root, wt, head: git(wt, 'rev-parse', 'HEAD').out };
}

test('R4: el veredicto de una entrega con interfaz exige también al diseñador', async (t) => {
  const { root, wt, head } = await delivered(t);
  await writeFiles(wt, { '.chalc/review.md': entry('seguridad', head) + entry('revisor', head) });
  const pending = await team(root, 'verdict', '--spec', A);
  assert.deepEqual([pending.code, pending.text.includes(TEXT.es.verdictPending(['disenador']))], [1, true]);
  await writeFiles(wt, { '.chalc/review.md': entry('seguridad', head) + entry('revisor', head) + entry('disenador', head) });
  assert.equal((await team(root, 'verdict', '--spec', A)).code, 0);
  assert.equal((await readStatus(root)).features[0].specs[0].state, 'reviewed_ok');
});

test('R5: al diseñador se le despacha sobre la entrega, con el worktree, el commit y la galería', async (t) => {
  const { root, wt, head } = await delivered(t);
  assert.equal((await team(root, 'dispatch', '--spec', A, '--role', 'disenador')).code, 0);
  const order = await readFile(join(root, '.chalc', 'team', 'orders', '027-checkout.disenador.md'), 'utf8');
  for (const piece of [wt, head, join(wt, '.chalc', 'design-out', 'gallery.html'), '.chalc/review.md']) assert.ok(order.includes(piece), piece);
});

test('R5: antes de la aprobación, el diseñador trabaja en el repo principal y sin galería', async (t) => {
  const { root } = await inDev(t);
  assert.equal((await team(root, 'dispatch', '--spec', A, '--role', 'disenador')).code, 0);
  const order = await readFile(join(root, '.chalc', 'team', 'orders', '027-checkout.disenador.md'), 'utf8');
  assert.ok(order.includes(root));
  assert.equal(order.includes('gallery.html'), false);
});

test('R6: el informe lista las galerías que existen, para verlas antes de aprobar el cierre', async (t) => {
  const { root, wt } = await delivered(t);
  const report = (await team(root, 'report', '--feature', 'pagos')).text;
  assert.ok(report.includes(TEXT.es.report.galleries));
  assert.ok(report.includes(join(wt, '.chalc', 'design-out', 'gallery.html')));
  const none = await inDev(t, '');
  assert.equal((await team(none.root, 'report', '--feature', 'pagos')).text.includes(TEXT.es.report.galleries), false);
  await appendEvent(none.root, { type: 'lead', feature: 'pagos', action: 'x' });
});
