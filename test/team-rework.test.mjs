// Spec 034 (roles y lanzadores), T5 — qué pasa con una entrega rechazada (R11): vuelve al mismo desarrollador
// hasta el tope de intentos, se relanza UNA vez con el nivel de modelo siguiente y, si tampoco, sube al usuario.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { team, writeFiles } from './helpers/teamrepo.mjs';
import { appendEvent, readLedger, readStatus } from '../catalog/team/lib/ledger.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const A = 'specs/027-checkout';
const reject = [{ type: 'delivered', spec: A, head: 'a' }, { type: 'reviewed', spec: A, role: 'revisor', ok: false, findings: 1, summary: 'falta R1' }];
async function rejected(t, { tier = 'medio', teamJson = {} } = {}) {
  const root = join(await tempDir(t, 'chalc-034-rework-'), 'repo');
  await writeFiles(root, { '.chalc/gate.json': JSON.stringify({ language: 'es' }), '.chalc/team.json': JSON.stringify(teamJson) });
  for (const event of [{ type: 'feature_opened', feature: 'pagos', agent: 'c' }, { type: 'spec_added', feature: 'pagos', spec: A },
    { type: 'started', spec: A, worktree: 'w', branch: 'b', launcher: 'nativo', tier }, ...reject]) await appendEvent(root, event);
  const run = () => team(root, 'rework', '--spec', A, '--root', root);
  // Otra ronda: rehacer y volver a ser rechazada.
  const again = async () => { const out = await run(); for (const event of reject) await appendEvent(root, event); return out; };
  return { root, run, again };
}
const specOf = async (root) => (await readStatus(root)).features[0].specs[0];
const lastType = async (root) => (await readLedger(root)).at(-1).type;

test('R11: por debajo del tope, vuelve al mismo desarrollador con un intento más', async (t) => {
  const { root, run } = await rejected(t);
  const out = await run();
  assert.equal(out.code, 0, out.text);
  const spec = await specOf(root);
  assert.deepEqual([spec.state, spec.attempt, spec.developer.tier, spec.relaunched], ['in_dev', 2, 'medio', false]);
  assert.equal(await lastType(root), 'rework');
});

test('R11: al alcanzar el tope se relanza UNA vez con el nivel siguiente, y los intentos empiezan de nuevo', async (t) => {
  const { root, run, again } = await rejected(t);
  await again();
  await again();
  assert.equal((await specOf(root)).attempt, 3);
  const out = await run();
  assert.equal(out.code, 0, out.text);
  const spec = await specOf(root);
  assert.deepEqual([spec.state, spec.attempt, spec.developer.tier, spec.relaunched], ['in_dev', 1, 'alto', true]);
  assert.ok(out.text.includes('alto'));
});

test('R11: si ya se relanzó y vuelve a agotar los intentos, se escala y queda en lo que espera al usuario', async (t) => {
  const { root, run, again } = await rejected(t);
  for (let round = 0; round < 5; round += 1) await again();
  assert.deepEqual([(await specOf(root)).attempt, (await specOf(root)).relaunched], [3, true]);
  const out = await run();
  assert.equal(out.code, 0, out.text);
  const status = await readStatus(root);
  const spec = status.features[0].specs[0];
  assert.deepEqual([spec.state, spec.blockedBy.includes('falta R1')], ['escalated', true]);
  assert.deepEqual(status.waitingHuman.map((w) => [w.feature, w.command]), [['pagos', 'node .chalc/team.mjs status']]);
  assert.ok(out.text.includes(TEXT.es.escalated(A)));
});

test('R11: sin nivel superior al que subir, al alcanzar el tope se escala directamente', async (t) => {
  const { root, run, again } = await rejected(t, { tier: 'alto' });
  await again();
  await again();
  await run();
  assert.deepEqual([(await specOf(root)).state, (await specOf(root)).relaunched], ['escalated', false]);
});

test('R11: el tope sale de team.json', async (t) => {
  const { root, run } = await rejected(t, { teamJson: { maxAttempts: 1 } });
  await run();
  assert.deepEqual([(await specOf(root)).relaunched, (await specOf(root)).developer.tier], [true, 'alto']);
});

test('R11: solo se rehace lo rechazado; sin --spec, el uso', async (t) => {
  const { root, run } = await rejected(t);
  await run();
  const twice = await run();
  assert.deepEqual([twice.code, twice.text.includes(TEXT.es.problems['not-rejected'](A))], [1, true]);
  const usage = await team(root, 'rework', '--root', root);
  assert.deepEqual([usage.code, usage.text.includes(TEXT.es.reworkUsage)], [1, true]);
});
