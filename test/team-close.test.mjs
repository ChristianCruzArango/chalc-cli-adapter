// Spec 035 (integración), T3 — el cierre de la feature (R8, R9, R10): el rol de cierre revisa lo integrado, y la
// fusión final —que ES la aprobación del cierre— la hace el usuario en su rama. chalc solo la comprueba.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { git, gitRepo, reviewedSpec, specFiles, team, writeFiles } from './helpers/teamrepo.mjs';
import { readLedger, readStatus } from '../catalog/team/lib/ledger.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const A = 'specs/027-checkout';
const B = 'specs/028-recibos';
const P = TEXT.es.problems;
const ROLES = [{ id: 'seguridad', order: 5, cadence: 'task', required: true }, { id: 'revisor', order: 10, cadence: 'task', required: true }, { id: 'endurecedor', order: 20, cadence: 'feature', required: true }];
const files = (roles) => ({
  '.chalc/gate.json': JSON.stringify({ language: 'es', spec: { dir: 'specs' }, test: { command: 'node --version' }, flow: { roles } }),
  '.chalc/roles/endurecedor.md': 'rol endurecedor\n', '.chalc/roles/revisor.md': 'rol revisor\n',
  ...specFiles('027-checkout', { touches: ['src/checkout/**'] }), ...specFiles('028-recibos', { touches: ['src/recibos/**'] })
});
// Una feature de dos specs; `integrated` dice cuántas quedan integradas.
async function feature(t, { integrated = 2, roles = ROLES } = {}) {
  const base = await tempDir(t, 'chalc-035-close-');
  const root = await gitRepo(base, files(roles));
  await team(root, 'open', '--feature', 'pagos', A, B);
  await team(root, 'waves', '--feature', 'pagos');
  const specs = [[A, { 'src/checkout/a.txt': 'a' }], [B, { 'src/recibos/b.txt': 'b' }]];
  for (const [spec, change] of specs.slice(0, integrated)) await reviewedSpec(root, spec, change);
  if (integrated) assert.equal((await team(root, 'integrate', '--feature', 'pagos')).code, 0);
  const int = join(base, 'repo.chalc-wt', 'int-pagos');
  const sign = (verdict, commit = git(int, 'rev-parse', 'HEAD').out.slice(0, 10)) => writeFiles(int, { '.chalc/review.md': `# Bitácora\n\n## 2026-11-22T12:00:00Z · ${commit} · endurecedor · ${verdict}\n\n- nota\n` });
  return { root, int, sign, close: () => team(root, 'close', '--feature', 'pagos') };
}
const waiting = async (root) => (await readStatus(root)).waitingHuman.map((w) => [w.feature, w.command]);

test('R9: con alguna spec sin integrar no hay cierre, y se dice cuál', async (t) => {
  const { root, close } = await feature(t, { integrated: 1 });
  const out = await close();
  assert.deepEqual([out.code, out.text.includes(P['not-integrated'](B))], [1, true]);
  assert.deepEqual(await waiting(root), []);
});

test('R8: el rol de cierre se despacha sobre el worktree de integración y su commit, y solo con todo integrado', async (t) => {
  const early = await feature(t, { integrated: 1 });
  const refused = await team(early.root, 'dispatch', '--spec', A, '--role', 'endurecedor');
  assert.deepEqual([refused.code, refused.text.includes(P['wrong-state']('endurecedor'))], [1, true]);
  const { root, int } = await feature(t);
  const out = await team(root, 'dispatch', '--spec', A, '--role', 'endurecedor');
  assert.equal(out.code, 0, out.text);
  const order = await readFile(join(root, '.chalc', 'team', 'orders', '027-checkout.endurecedor.md'), 'utf8');
  for (const piece of [int, git(int, 'rev-parse', 'HEAD').out, '.chalc/review.md']) assert.ok(order.includes(piece), piece);
});

test('R9: mientras el rol de cierre no firme sobre el commit integrado, no se le pide nada al usuario', async (t) => {
  const { root, sign, close } = await feature(t);
  const none = await close();
  assert.deepEqual([none.code, none.text.includes(TEXT.es.verdictPending(['endurecedor']))], [1, true]);
  await sign('OK', 'fff0000aaa');
  assert.equal((await close()).code, 1, 'una firma sobre otro commit no cuenta');
  assert.deepEqual(await waiting(root), []);
});

test('R9: con hallazgos del rol de cierre tampoco se pide la fusión', async (t) => {
  const { root, sign, close } = await feature(t);
  await sign('FINDINGS: 2');
  const out = await close();
  assert.equal(out.code, 1);
  assert.ok(out.text.includes(TEXT.es.findingsIn(2)), out.text);
  assert.deepEqual(await waiting(root), []);
});

test('R9: firmado en OK, la fusión de la rama de integración queda esperando al usuario, una sola vez', async (t) => {
  const { root, sign, close } = await feature(t);
  await sign('OK');
  const out = await close();
  assert.equal(out.code, 0, out.text);
  assert.ok(out.text.includes('git merge chalc/int-pagos'));
  await close();
  assert.deepEqual(await waiting(root), [['pagos', 'git merge chalc/int-pagos']]);
  assert.equal((await readStatus(root)).features[0].closed, false, 'pedirla no es cerrarla');
});

test('R10: cuando el usuario fusiona la rama de integración en la suya, el cierre queda registrado', async (t) => {
  const { root, sign, close } = await feature(t);
  await sign('OK');
  await close();
  assert.equal(git(root, 'merge', '--no-edit', 'chalc/int-pagos').status, 0);
  const out = await close();
  assert.equal(out.code, 0, out.text);
  const status = await readStatus(root);
  assert.deepEqual([status.features[0].closed, status.waitingHuman], [true, []]);
  assert.equal((await readLedger(root)).at(-1).type, 'closed');
  const report = (await team(root, 'report', '--feature', 'pagos')).text;
  assert.equal(report.includes(TEXT.es.report.notClosed), false);
  assert.equal((await close()).code, 0, 'repetirlo no duplica el cierre');
  assert.equal((await readLedger(root)).filter((e) => e.type === 'closed').length, 1);
});

test('R9: si el proyecto no exige rol de cierre, se pide la fusión directamente', async (t) => {
  const { root, close } = await feature(t, { roles: ROLES.slice(0, 2) });
  assert.equal((await close()).code, 0);
  assert.deepEqual(await waiting(root), [['pagos', 'git merge chalc/int-pagos']]);
});

test('R9: sin --feature, o con una feature que no existe, se niega', async (t) => {
  const { root } = await feature(t, { integrated: 0 });
  const usage = await team(root, 'close');
  assert.deepEqual([usage.code, usage.text.includes(TEXT.es.closeUsage)], [1, true]);
  assert.equal((await team(root, 'close', '--feature', 'nadie')).code, 1);
});
