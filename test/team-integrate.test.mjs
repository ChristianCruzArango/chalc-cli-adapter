// Spec 035 (integración), T1 y T2 — unir lo aprobado y medir la unión (R1–R7). Que cada rama pase sola no dice
// que pasen juntas: se unen de una en una, se corren las pruebas, y la que rompe se nombra.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { commitAll, git, gitRepo, passGate, reviewedSpec, specFiles, team, writeFiles } from './helpers/teamrepo.mjs';
import { readLedger, readStatus } from '../catalog/team/lib/ledger.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const A = 'specs/027-checkout';
const B = 'specs/028-recibos';
const C = 'specs/029-total';
const P = TEXT.es.problems;
// Las pruebas del proyecto: fallan solo cuando los dos módulos están juntos.
const CHECK = "const fs = require('fs');\nprocess.exit(fs.existsSync('src/checkout/x.txt') && fs.existsSync('src/recibos/x.txt') ? 1 : 0);\n";
const gate = (test) => JSON.stringify({ language: 'es', spec: { dir: 'specs' }, test: { command: test }, flow: { roles: [
  { id: 'seguridad', order: 5, cadence: 'task', required: true }, { id: 'revisor', order: 10, cadence: 'task', required: true }, { id: 'endurecedor', order: 20, cadence: 'feature', required: true }] } });
const FILES = (test = 'node check.js') => ({
  '.chalc/gate.json': gate(test), 'check.js': CHECK, 'src/shared.txt': 'base\n',
  ...specFiles('027-checkout', { touches: ['src/checkout/**', 'src/shared.txt'] }),
  ...specFiles('028-recibos', { touches: ['src/recibos/**'] }),
  ...specFiles('029-total', { touches: ['src/shared.txt', 'src/total/**'] })
});
async function feature(t, test) {
  const base = await tempDir(t, 'chalc-035-int-');
  const root = await gitRepo(base, FILES(test));
  assert.equal((await team(root, 'open', '--feature', 'pagos', A, B, C)).code, 0);
  assert.equal((await team(root, 'waves', '--feature', 'pagos')).code, 0);
  return { base, root, int: join(base, 'repo.chalc-wt', 'int-pagos'), head: git(root, 'rev-parse', 'HEAD').out };
}
const states = async (root) => (await readStatus(root)).features[0].specs.map((s) => s.state);
const specOf = async (root, spec) => (await readStatus(root)).features[0].specs.find((s) => s.spec === spec);
const integrate = (root) => team(root, 'integrate', '--feature', 'pagos');

test('R1, R2: une las specs revisadas en la rama de integración, en su worktree, y las registra integradas', async (t) => {
  const { root, int, head } = await feature(t);
  await reviewedSpec(root, A, { 'src/checkout/a.txt': 'a' });
  await reviewedSpec(root, B, { 'src/recibos/b.txt': 'b' });
  const out = await integrate(root);
  assert.equal(out.code, 0, out.text);
  assert.equal(git(int, 'rev-parse', '--abbrev-ref', 'HEAD').out, 'chalc/int-pagos');
  for (const file of ['src/checkout/a.txt', 'src/recibos/b.txt']) assert.ok(existsSync(join(int, ...file.split('/'))), file);
  assert.deepEqual(await states(root), ['integrated', 'integrated', 'scheduled']);
  const integrated = (await readLedger(root)).filter((e) => e.type === 'integrated');
  assert.deepEqual(integrated.map((e) => e.spec), [A, B]);
  assert.equal(integrated.at(-1).head, git(int, 'rev-parse', 'HEAD').out);
  assert.equal(git(root, 'rev-parse', 'HEAD').out, head, 'la rama del usuario no se toca');
  assert.equal(existsSync(join(root, 'src', 'checkout', 'a.txt')), false);
});

test('R4: la evidencia que cambiaron las dos ramas se une sola: las bitácoras se suman', async (t) => {
  const { root, int } = await feature(t);
  await reviewedSpec(root, A, { 'src/checkout/a.txt': 'a', '.chalc/tdd.jsonl': '{"task":"A"}\n', '.chalc/review.md': '## nota de A\n' });
  await reviewedSpec(root, B, { 'src/recibos/b.txt': 'b', '.chalc/tdd.jsonl': '{"task":"B"}\n', '.chalc/review.md': '## nota de B\n' });
  const out = await integrate(root);
  assert.equal(out.code, 0, out.text);
  const tdd = await readFile(join(int, '.chalc', 'tdd.jsonl'), 'utf8');
  assert.ok(tdd.includes('"A"') && tdd.includes('"B"'), tdd);
  const review = await readFile(join(int, '.chalc', 'review.md'), 'utf8');
  assert.ok(review.includes('nota de A') && review.includes('nota de B'));
  assert.equal(/^[<=>]{7}/m.test(tdd + review), false, 'sin marcas de conflicto');
  assert.equal(git(int, 'status', '--porcelain').out, '');
});

test('R3: dos ramas verdes que rompen juntas: se deshace la unión, se nombra a la culpable y se para', async (t) => {
  const { root, int } = await feature(t);
  await reviewedSpec(root, A, { 'src/checkout/x.txt': 'a' });
  await reviewedSpec(root, B, { 'src/recibos/x.txt': 'b' });
  const out = await integrate(root);
  assert.equal(out.code, 1);
  assert.ok(out.text.includes(TEXT.es.breaksTogether(B)), out.text);
  assert.ok(existsSync(join(int, 'src', 'checkout', 'x.txt')));
  assert.equal(existsSync(join(int, 'src', 'recibos', 'x.txt')), false, 'la unión de B se deshizo');
  assert.equal(git(int, 'status', '--porcelain').out, '');
  const b = await specOf(root, B);
  assert.deepEqual([(await states(root))[0], b.state, b.lastFinding.startsWith('integracion: ')], ['integrated', 'rejected', true]);
});

test('R5: un conflicto real aborta la unión, bloquea esa spec con sus archivos y lo deja al usuario', async (t) => {
  const { root, int, head } = await feature(t);
  await reviewedSpec(root, A, { 'src/shared.txt': 'cambio de A\n' });
  await reviewedSpec(root, B, { 'src/recibos/b.txt': 'b' });
  assert.equal((await integrate(root)).code, 0);
  // C parte de la base vieja y toca el mismo archivo que A ya cambió.
  await reviewedSpec(root, C, { 'src/shared.txt': 'cambio de C\n' }, { startArgs: ['--base', head] });
  const out = await integrate(root);
  assert.equal(out.code, 1);
  const c = await specOf(root, C);
  assert.deepEqual([c.state, c.blockedBy.includes('src/shared.txt')], ['blocked', true]);
  assert.deepEqual((await readStatus(root)).waitingHuman.map((w) => w.feature), ['pagos']);
  assert.equal(git(int, 'status', '--porcelain').out, '', 'la unión se abortó');
  assert.equal(await readFile(join(int, 'src', 'shared.txt'), 'utf8'), 'cambio de A\n');
});

test('R6: sin comando de pruebas, sin feature o sin nada revisado, se niega', async (t) => {
  const none = await feature(t, '');
  await reviewedSpec(none.root, A, { 'src/checkout/a.txt': 'a' });
  const out = await integrate(none.root);
  assert.deepEqual([out.code, out.text.includes(P['no-test-command']())], [1, true]);
  assert.equal((await states(none.root))[0], 'reviewed_ok');
  const { root } = await feature(t);
  const idle = await integrate(root);
  assert.deepEqual([idle.code, idle.text.includes(P['nothing-to-integrate']('pagos'))], [1, true]);
  assert.equal((await team(root, 'integrate', '--feature', 'nadie')).code, 1);
  const usage = await team(root, 'integrate');
  assert.deepEqual([usage.code, usage.text.includes(TEXT.es.integrateUsage)], [1, true]);
});

test('R1: integrar otra vez solo une lo nuevo', async (t) => {
  const { root, int } = await feature(t);
  await reviewedSpec(root, A, { 'src/checkout/a.txt': 'a' });
  assert.equal((await integrate(root)).code, 0);
  await reviewedSpec(root, B, { 'src/recibos/b.txt': 'b' });
  assert.equal((await integrate(root)).code, 0);
  assert.deepEqual((await readLedger(root)).filter((e) => e.type === 'integrated').map((e) => e.spec), [A, B]);
  assert.ok(existsSync(join(int, 'src', 'recibos', 'b.txt')));
});

// ── T2 (R7) ───────────────────────────────────────────────────────────────────────────────────────

test('R7: una spec de una ola posterior empieza sobre lo ya integrado', async (t) => {
  const { root } = await feature(t);
  await reviewedSpec(root, A, { 'src/checkout/a.txt': 'a' });
  await reviewedSpec(root, B, { 'src/recibos/b.txt': 'b' });
  await integrate(root);
  assert.equal((await team(root, 'start', '--spec', C)).code, 0);
  const c = await specOf(root, C);
  for (const file of ['src/checkout/a.txt', 'src/recibos/b.txt']) assert.ok(existsSync(join(c.worktree, ...file.split('/'))), file);
  assert.equal((await readLedger(root)).at(-1).base, git(root, 'rev-parse', 'chalc/int-pagos').out);
});

test('R7: la spec rechazada en la integración trae lo integrado a su rama, arregla y entrega: su alcance sigue siendo el suyo', async (t) => {
  const { root } = await feature(t);
  await reviewedSpec(root, A, { 'src/checkout/x.txt': 'a' });
  const wtB = await reviewedSpec(root, B, { 'src/recibos/x.txt': 'b' });
  assert.equal((await integrate(root)).code, 1);
  assert.equal((await team(root, 'rework', '--spec', B)).code, 0);
  assert.equal(git(wtB, 'merge', '--no-edit', 'chalc/int-pagos').status, 0);
  git(wtB, 'rm', '-q', 'src/recibos/x.txt');
  await writeFiles(wtB, { 'src/recibos/y.txt': 'arreglado' });
  commitAll(wtB, 'arreglo');
  await passGate(wtB, B);
  const out = await team(wtB, 'deliver', '--spec', B);
  assert.equal(out.code, 0, out.text);
});
