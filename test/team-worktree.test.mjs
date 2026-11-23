// Spec 033 (worktrees y olas), T4 y T5 — empezar y entregar una spec (R6–R9): cada spec en su worktree y su rama,
// y la entrega solo entra si se quedó en lo que su plan declaró.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { GATE_ES, commitAll, git, gitRepo, passGate, specFiles, team, writeFiles } from './helpers/teamrepo.mjs';
import { readLedger, readStatus } from '../catalog/team/lib/ledger.mjs';
import { activeSpecDir } from '../catalog/gate/lib/spec.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const A = 'specs/027-checkout';
const B = 'specs/028-recibos';
const C = 'specs/029-total';
const P = TEXT.es.problems;
const SPECS = () => ({
  ...GATE_ES, 'src/checkout/index.ts': 'export {};\n',
  ...specFiles('027-checkout', { touches: ['src/checkout/**', 'test/checkout/**'] }),
  ...specFiles('028-recibos', { touches: ['src/recibos/**'] }),
  ...specFiles('029-total', { touches: ['src/checkout/total.ts'] })
});
// Un repo con las tres specs commiteadas, abiertas y programadas: A y B en la ola 1, C en la 2.
async function scheduled(t, extra = {}) {
  const base = await tempDir(t, 'chalc-033-wt-');
  const root = await gitRepo(base, { ...SPECS(), ...extra });
  assert.equal((await team(root, 'open', '--feature', 'pagos', A, B, C)).code, 0);
  assert.equal((await team(root, 'waves', '--feature', 'pagos')).code, 0);
  return { base, root, wt: join(base, 'repo.chalc-wt', '027-checkout') };
}
const stateOf = async (root, spec) => (await readStatus(root)).features[0].specs.find((s) => s.spec === spec);
const same = (a, b) => assert.equal(realpathSync.native(a), realpathSync.native(b));

// ── start ─────────────────────────────────────────────────────────────────────────────────────────

test('R6: `start` crea el worktree con su rama, fija la spec activa y registra el inicio con su base', async (t) => {
  const { root, wt } = await scheduled(t);
  const head = git(root, 'rev-parse', 'HEAD').out;
  const out = await team(root, 'start', '--spec', A);
  assert.equal(out.code, 0, out.text);
  assert.ok(existsSync(join(wt, 'src', 'checkout', 'index.ts')));
  assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').out, 'chalc/027-checkout');
  assert.deepEqual(await activeSpecDir(wt, 'specs'), { dir: A, problem: '', pinned: true });
  assert.equal(git(wt, 'status', '--porcelain').out, '', 'fijar la spec no ensucia el worktree');
  const started = (await readLedger(root)).at(-1);
  assert.deepEqual([started.type, started.spec, started.branch, started.base, started.launcher, started.tier], ['started', A, 'chalc/027-checkout', head, 'nativo', 'medio']);
  same(started.worktree, wt);
  const now = await stateOf(root, A);
  assert.deepEqual([now.state, now.attempt], ['in_dev', 1]);
  assert.ok(out.text.includes('027-checkout'));
});

test('R6: el lanzador y el nivel se pueden indicar, y la carpeta de worktrees sale de team.json', async (t) => {
  const { base, root } = await scheduled(t);
  await writeFile(join(root, '.chalc', 'team.json'), JSON.stringify({ worktreesDir: '../arboles' }));
  assert.equal((await team(root, 'start', '--spec', B, 'launcher=codex', 'tier=alto')).code, 0);
  const now = await stateOf(root, B);
  assert.deepEqual(now.developer, { launcher: 'codex', tier: 'alto' });
  same(now.worktree, join(base, 'arboles', '028-recibos'));
});

test('R6: aunque el repo versione su propia spec activa, el worktree fija la suya sin ensuciarse', async (t) => {
  const { root, wt } = await scheduled(t, { '.chalc/active-spec': `${B}\n` });
  assert.equal((await team(root, 'start', '--spec', A)).code, 0);
  assert.equal((await activeSpecDir(wt, 'specs')).dir, A);
  assert.equal(git(wt, 'status', '--porcelain').out, '');
  assert.equal((await activeSpecDir(root, 'specs')).dir, B, 'el repo principal no cambia');
});

test('R7: una spec sin programar, desconocida o sin --spec no empieza', async (t) => {
  const base = await tempDir(t, 'chalc-033-wt-');
  const root = await gitRepo(base, SPECS());
  await team(root, 'open', '--feature', 'pagos', A);
  const out = await team(root, 'start', '--spec', A);
  assert.deepEqual([out.code, out.text.includes(P['not-scheduled'](A))], [1, true]);
  assert.equal((await team(root, 'start', '--spec', 'specs/099-nadie')).code, 1);
  const usage = await team(root, 'start');
  assert.deepEqual([usage.code, usage.text.includes(TEXT.es.startUsage)], [1, true]);
  assert.equal(existsSync(join(base, 'repo.chalc-wt')), false);
});

test('R7: una spec de una ola posterior espera a que las anteriores estén integradas', async (t) => {
  const { root } = await scheduled(t);
  const early = await team(root, 'start', '--spec', C);
  assert.deepEqual([early.code, early.text.includes(P['earlier-wave-pending'](A))], [1, true]);
  for (const spec of [A, B]) await team(root, 'event', 'integrated', `spec=${spec}`, 'head=abc');
  assert.equal((await team(root, 'start', '--spec', C)).code, 0);
});

test('R7: con la spec o su sello sin commitear no se empieza: el worktree no los tendría', async (t) => {
  const base = await tempDir(t, 'chalc-033-wt-');
  const root = await gitRepo(base, { ...GATE_ES, 'a.txt': 'x' });
  await writeFiles(root, specFiles('027-checkout', { touches: ['src/**'] }));
  await team(root, 'open', '--feature', 'pagos', A);
  await team(root, 'waves', '--feature', 'pagos');
  const out = await team(root, 'start', '--spec', A);
  assert.deepEqual([out.code, out.text.includes(P['spec-uncommitted'](A))], [1, true]);
  assert.equal((await stateOf(root, A)).state, 'scheduled');
});

test('R7: si la rama o la carpeta del worktree ya existen, no se toca nada', async (t) => {
  const { root, wt } = await scheduled(t);
  git(root, 'branch', 'chalc/027-checkout');
  const branch = await team(root, 'start', '--spec', A);
  assert.deepEqual([branch.code, branch.text.includes(P['branch-exists']('chalc/027-checkout'))], [1, true]);
  git(root, 'branch', '-D', 'chalc/027-checkout');
  await mkdir(wt, { recursive: true });
  const folder = await team(root, 'start', '--spec', A);
  assert.equal(folder.code, 1);
  assert.ok(folder.text.includes('027-checkout'));
  assert.equal((await stateOf(root, A)).state, 'scheduled');
});

test('R7: fuera de un repo de git no hay worktrees', async (t) => {
  const root = await tempDir(t, 'chalc-033-nogit-');
  await writeFiles(root, SPECS());
  await team(root, 'open', '--feature', 'pagos', A, '--root', root);
  await team(root, 'waves', '--feature', 'pagos', '--root', root);
  const out = await team(root, 'start', '--spec', A, '--root', root);
  assert.deepEqual([out.code, out.text.includes(P['no-git']())], [1, true]);
});

// ── deliver ───────────────────────────────────────────────────────────────────────────────────────

async function inDev(t) {
  const made = await scheduled(t);
  assert.equal((await team(made.root, 'start', '--spec', A)).code, 0);
  return made;
}
// Commitea `files` y deja la evidencia que exige una entrega (spec 034, R9): tareas marcadas y portón aprobado.
const work = async (wt, files, message) => { await writeFiles(wt, files); commitAll(wt, message); return passGate(wt, A); };

test('R8: `deliver` desde el worktree registra la entrega con su commit, en el registro del repo principal', async (t) => {
  const { root, wt } = await inDev(t);
  const head = await work(wt, { 'src/checkout/total.ts': 'export const total = 1;\n', 'test/checkout/total.test.ts': '// R1\n' });
  const out = await team(wt, 'deliver', '--spec', A);
  assert.equal(out.code, 0, out.text);
  assert.deepEqual((({ type, spec, head: h }) => [type, spec, h])((await readLedger(root)).at(-1)), ['delivered', A, head]);
  assert.equal((await stateOf(root, A)).state, 'delivered');
  assert.equal(existsSync(join(wt, '.chalc', 'team', 'ledger.jsonl')), false);
});

test('R9: la carpeta de la propia spec y la evidencia del portón siempre están dentro del alcance', async (t) => {
  const { wt } = await inDev(t);
  await work(wt, {
    'src/checkout/a.ts': 'x', [`${A}/notas.md`]: 'x', '.chalc/gate.md': 'x', '.chalc/gate.state.json': '{}', '.chalc/review.md': 'x', '.chalc/tdd.jsonl': '{}\n'
  });
  const out = await team(wt, 'deliver', '--spec', A);
  assert.equal(out.code, 0, out.text);
});

test('R9: un archivo fuera de `Toca:` impide la entrega, y se listan solo los que sobran', async (t) => {
  const { root, wt } = await inDev(t);
  await work(wt, { 'src/checkout/a.ts': 'x', 'src/recibos/b.ts': 'x', '.chalc/gate.json': '{"language":"es","mutation":{"threshold":1}}', 'specs/028-recibos/plan.md': 'x' });
  const out = await team(wt, 'deliver', '--spec', A);
  assert.equal(out.code, 1);
  assert.ok(out.text.includes(P['out-of-scope'](A)));
  for (const file of ['src/recibos/b.ts', '.chalc/gate.json', 'specs/028-recibos/plan.md']) assert.ok(out.text.includes(file), file);
  assert.equal(out.text.includes('src/checkout/a.ts'), false);
  assert.equal((await stateOf(root, A)).state, 'in_dev');
});

test('R9: con cambios sin commitear, o sin ningún commit sobre la base, no hay entrega', async (t) => {
  const { wt } = await inDev(t);
  const empty = await team(wt, 'deliver', '--spec', A);
  assert.deepEqual([empty.code, empty.text.includes(P['nothing-delivered'](A))], [1, true]);
  await work(wt, { 'src/checkout/a.ts': 'x' });
  await writeFile(join(wt, 'src', 'checkout', 'b.ts'), 'sin commitear');
  const dirty = await team(wt, 'deliver', '--spec', A);
  assert.deepEqual([dirty.code, dirty.text.includes(P['dirty-tree'](A))], [1, true]);
});

test('R9: ampliar `Toca:` en el plan no cuela nada: la spec deja de estar aprobada', async (t) => {
  const { wt } = await inDev(t);
  await appendFile(join(wt, 'specs', '027-checkout', 'plan.md'), 'Toca: src/recibos/**\n');
  await work(wt, { 'src/recibos/b.ts': 'x' });
  const out = await team(wt, 'deliver', '--spec', A);
  assert.deepEqual([out.code, out.text.includes(P['not-approved'](A))], [1, true]);
});

test('R9: solo se entrega desde el worktree de la spec, y solo lo que está en desarrollo', async (t) => {
  const { root, wt } = await inDev(t);
  await work(wt, { 'src/checkout/a.ts': 'x' });
  const elsewhere = await team(root, 'deliver', '--spec', A);
  assert.deepEqual([elsewhere.code, elsewhere.text.includes(P['wrong-worktree']('chalc/027-checkout'))], [1, true]);
  const idle = await team(wt, 'deliver', '--spec', B);
  assert.deepEqual([idle.code, idle.text.includes(P['not-in-dev'](B))], [1, true]);
  const usage = await team(wt, 'deliver');
  assert.deepEqual([usage.code, usage.text.includes(TEXT.es.deliverUsage)], [1, true]);
  assert.equal((await team(wt, 'deliver', '--spec', A)).code, 0);
  assert.equal((await team(wt, 'deliver', '--spec', A)).code, 1, 'ya entregada: no está en desarrollo');
});

test('R8: tras un rechazo y su rework, la misma spec se vuelve a entregar', async (t) => {
  const { root, wt } = await inDev(t);
  await work(wt, { 'src/checkout/a.ts': 'x' });
  await team(wt, 'deliver', '--spec', A);
  await team(root, 'event', 'reviewed', `spec=${A}`, 'role=revisor', 'ok=false', 'findings=1', 'summary=falta R1');
  await team(root, 'event', 'rework', `spec=${A}`);
  const head = await work(wt, { 'src/checkout/a.ts': 'y' }, 'arreglo');
  assert.equal((await team(wt, 'deliver', '--spec', A)).code, 0);
  assert.equal((await readLedger(root)).at(-1).head, head);
});

// ── Spec 034, R9 — la entrega exige evidencia ────────────────────────────────────────────────────────────

test('034 R9: con tareas sin marcar no hay entrega', async (t) => {
  const { wt } = await inDev(t);
  await writeFiles(wt, { 'src/checkout/a.ts': 'x' });
  commitAll(wt, 'código');
  const out = await team(wt, 'deliver', '--spec', A);
  assert.deepEqual([out.code, out.text.includes(P['tasks-open'](A))], [1, true]);
});

test('034 R9: sin evidencia del portón, con una corrida rápida, con una que no aprobó o de otro código, no hay entrega', async (t) => {
  for (const state of [{ verdict: 'fail' }, { fast: true }, { head: 'deadbeef' }, { head: '' }]) {
    const { wt } = await inDev(t);
    await writeFiles(wt, { 'src/checkout/a.ts': 'x' });
    commitAll(wt, 'código');
    await passGate(wt, A, state);
    const out = await team(wt, 'deliver', '--spec', A);
    assert.deepEqual([out.code, out.text.includes(P['gate-not-passed'](A))], [1, true], JSON.stringify(state));
  }
});

test('034 R9: código commiteado después del portón deja la evidencia vieja', async (t) => {
  const { wt } = await inDev(t);
  await work(wt, { 'src/checkout/a.ts': 'x' });
  await writeFiles(wt, { 'src/checkout/a.ts': 'cambiado sin volver a medir' });
  commitAll(wt, 'después del portón');
  const out = await team(wt, 'deliver', '--spec', A);
  assert.deepEqual([out.code, out.text.includes(P['gate-not-passed'](A))], [1, true]);
});

test('034 R9: al entregar se registra el resultado del portón que lo respalda', async (t) => {
  const { root, wt } = await inDev(t);
  await work(wt, { 'src/checkout/a.ts': 'x' });
  assert.equal((await team(wt, 'deliver', '--spec', A)).code, 0);
  const [gate, delivered] = (await readLedger(root)).slice(-2);
  assert.deepEqual([gate.type, gate.verdict, gate.score, gate.fast, delivered.type], ['gate', 'pass', 92, false, 'delivered']);
  assert.deepEqual((await stateOf(root, A)).lastGate.score, 92);
});
