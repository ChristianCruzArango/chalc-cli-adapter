// Spec 034 (roles y lanzadores), T4 — el veredicto de una entrega (R10): sale de la bitácora de revisión del
// worktree, sobre el commit entregado. La palabra de un rol sin su entrada no cuenta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { team, writeFiles } from './helpers/teamrepo.mjs';
import { appendEvent, readLedger, readStatus } from '../catalog/team/lib/ledger.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const A = 'specs/027-checkout';
const HEAD = 'abc1234def5678';
const P = TEXT.es.problems;
const roles = (list) => ({ '.chalc/gate.json': JSON.stringify({ language: 'es', flow: { roles: list } }) });
const BOTH = [{ id: 'revisor', order: 10, cadence: 'task', required: true }, { id: 'seguridad', order: 5, cadence: 'task', required: true }, { id: 'endurecedor', order: 20, cadence: 'feature', required: true }];
const entry = (role, verdict, commit = 'abc1234', date = '2026-11-22T10:05:00Z') => `## ${date} · ${commit} · ${role} · ${verdict}\n\n- nota\n\n`;

async function delivered(t, flowRoles = BOTH) {
  const base = await tempDir(t, 'chalc-034-verdict-');
  const root = join(base, 'repo');
  const wt = join(base, 'wt');
  await writeFiles(root, roles(flowRoles));
  await writeFiles(wt, { '.chalc/review.md': '# Bitácora\n\n' });
  for (const event of [{ type: 'feature_opened', feature: 'pagos', agent: 'c' }, { type: 'spec_added', feature: 'pagos', spec: A },
    { type: 'started', spec: A, worktree: wt, branch: 'chalc/027-checkout', launcher: 'nativo', tier: 'medio' }, { type: 'delivered', spec: A, head: HEAD }]) await appendEvent(root, event);
  const log = (text) => writeFile(join(wt, '.chalc', 'review.md'), `# Bitácora\n\n${text}`);
  return { root, log, run: () => team(root, 'verdict', '--spec', A, '--root', root) };
}
const stateOf = async (root) => (await readStatus(root)).features[0].specs[0];
const reviews = async (root) => (await readLedger(root)).filter((e) => e.type === 'reviewed').map((e) => [e.role, e.ok, e.findings]);

test('R10: con la entrada de cada rol sobre el commit entregado y todas OK, la entrega queda revisada', async (t) => {
  const { root, log, run } = await delivered(t);
  await log(entry('seguridad', 'OK') + entry('revisor', 'OK'));
  const out = await run();
  assert.equal(out.code, 0, out.text);
  assert.deepEqual(await reviews(root), [['seguridad', true, 0], ['revisor', true, 0]], 'en el orden de los roles');
  assert.equal((await stateOf(root)).state, 'reviewed_ok');
});

test('R10: mientras falte un rol no se registra nada y se dice quién falta', async (t) => {
  const { root, log, run } = await delivered(t);
  await log(entry('seguridad', 'OK'));
  const out = await run();
  assert.equal(out.code, 1);
  assert.ok(out.text.includes(TEXT.es.verdictPending(['revisor'])), out.text);
  assert.deepEqual(await reviews(root), []);
  assert.equal((await stateOf(root)).state, 'delivered');
});

test('R10: una entrada sobre OTRO commit, o de un rol que no se exige, no cuenta', async (t) => {
  const { root, log, run } = await delivered(t);
  await log(entry('seguridad', 'OK', 'fff0000') + entry('revisor', 'OK') + entry('endurecedor', 'OK') + entry('mago', 'OK'));
  const out = await run();
  assert.equal(out.code, 1);
  assert.ok(out.text.includes(TEXT.es.verdictPending(['seguridad'])));
  assert.deepEqual(await reviews(root), []);
});

test('R10: un rol con hallazgos rechaza la entrega aunque falte otro, con cuántos y dónde leerlos', async (t) => {
  const { root, log, run } = await delivered(t);
  await log(entry('seguridad', 'FINDINGS: 2'));
  const out = await run();
  assert.equal(out.code, 1);
  assert.deepEqual(await reviews(root), [['seguridad', false, 2]]);
  const state = await stateOf(root);
  assert.deepEqual([state.state, state.lastFinding.includes('.chalc/review.md'), state.lastFinding.startsWith('seguridad: 2')], ['rejected', true, true]);
});

test('R10: vale la ÚLTIMA entrada de cada rol sobre ese commit, y repetir el veredicto no duplica nada', async (t) => {
  const { root, log, run } = await delivered(t);
  await log(entry('revisor', 'FINDINGS: 1', 'abc1234', '2026-11-22T10:01:00Z') + entry('revisor', 'OK', 'abc1234', '2026-11-22T10:09:00Z') + entry('seguridad', 'OK'));
  assert.equal((await run()).code, 0);
  assert.equal((await run()).code, 0);
  assert.deepEqual(await reviews(root), [['seguridad', true, 0], ['revisor', true, 0]]);
});

test('R10: tras un rechazo y una entrega nueva, cuentan solo las entradas sobre el commit nuevo', async (t) => {
  const { root, log, run } = await delivered(t);
  await log(entry('seguridad', 'OK') + entry('revisor', 'FINDINGS: 1'));
  await run();
  for (const event of [{ type: 'rework', spec: A }, { type: 'delivered', spec: A, head: 'bbb2222ccc' }]) await appendEvent(root, event);
  const stale = await run();
  assert.equal(stale.code, 1);
  assert.ok(stale.text.includes(TEXT.es.verdictPending(['seguridad', 'revisor'])));
  await log(entry('seguridad', 'OK', 'bbb2222') + entry('revisor', 'OK', 'bbb2222'));
  assert.equal((await run()).code, 0);
  assert.equal((await stateOf(root)).state, 'reviewed_ok');
});

test('R10: un rol apagado en gate.json no se exige; sin ningún revisor, la entrega no se da por revisada', async (t) => {
  const one = await delivered(t, [BOTH[0], { ...BOTH[1], required: false }]);
  await one.log(entry('revisor', 'OK'));
  assert.equal((await one.run()).code, 0);
  const none = await delivered(t, []);
  const out = await none.run();
  assert.deepEqual([out.code, out.text.includes(P['no-reviewers'](A))], [1, true]);
});

test('R10: sin bitácora, sin entrega o sin --spec, se niega', async (t) => {
  const { root, run } = await delivered(t);
  assert.equal((await run()).code, 1, 'bitácora vacía: faltan todos');
  await appendEvent(root, { type: 'spec_added', feature: 'pagos', spec: 'specs/028-otra' });
  const idle = await team(root, 'verdict', '--spec', 'specs/028-otra', '--root', root);
  assert.deepEqual([idle.code, idle.text.includes(P['not-delivered']('specs/028-otra'))], [1, true]);
  const usage = await team(root, 'verdict', '--root', root);
  assert.deepEqual([usage.code, usage.text.includes(TEXT.es.verdictUsage)], [1, true]);
});
