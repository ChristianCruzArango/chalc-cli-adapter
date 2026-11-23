// Specs 032–035 — los bordes que los tests por comando no tocaban: el comando de preparación al integrar, el orden
// por olas, recrear el worktree de integración, enseñar a git dos veces a unir la evidencia, y las formas menos
// habituales de declarar el alcance o de pasar la raíz.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { git, gitRepo, reviewedSpec, specFiles, team, writeFiles } from './helpers/teamrepo.mjs';
import { appendEvent, readLedger, readStatus } from '../catalog/team/lib/ledger.mjs';
import { evidenceMerges } from '../catalog/team/lib/evidencemerge.mjs';
import { ensureIntegration, hasIntegration, intBranch, intDir } from '../catalog/team/lib/integration.mjs';
import { mainRoot } from '../catalog/team/lib/root.mjs';
import { inScope, normalPath, overlaps, planScope } from '../catalog/team/lib/scope.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const A = 'specs/027-checkout';
const B = 'specs/028-recibos';
const P = TEXT.es.problems;
const gate = (command) => JSON.stringify({ language: 'es', spec: { dir: 'specs' }, test: { command }, flow: { roles: [] } });
async function feature(t, { teamJson = null, test: command = 'node --version' } = {}) {
  const base = await tempDir(t, 'chalc-035-edges-');
  const root = await gitRepo(base, { '.chalc/gate.json': gate(command), 'ok.js': 'process.exit(0);\n', 'mal.js': 'process.exit(1);\n', ...(teamJson ? { '.chalc/team.json': JSON.stringify(teamJson) } : {}),
    ...specFiles('027-checkout', { touches: ['src/checkout/**'] }), ...specFiles('028-recibos', { touches: ['src/recibos/**'] }) });
  await team(root, 'open', '--feature', 'pagos', A, B);
  await team(root, 'waves', '--feature', 'pagos');
  return { base, root, int: join(base, 'repo.chalc-wt', 'int-pagos') };
}
const stateOf = async (root, spec) => (await readStatus(root)).features[0].specs.find((s) => s.spec === spec).state;

test('035 R2: el comando de preparación corre antes de las pruebas; si falla, la unión se deshace y nadie queda rechazado', async (t) => {
  const { root, int } = await feature(t, { teamJson: { setup: 'node mal.js' } });
  await reviewedSpec(root, A, { 'src/checkout/a.txt': 'a' }, { roles: [] });
  await appendEvent(root, { type: 'reviewed', spec: A, role: 'revisor', ok: true, findings: 0, summary: 'OK' });
  const out = await team(root, 'integrate', '--feature', 'pagos');
  assert.deepEqual([out.code, out.text], [1, P['setup-failed'](A)]);
  assert.equal(existsSync(join(int, 'src', 'checkout', 'a.txt')), false, 'la unión se deshizo');
  assert.equal(await stateOf(root, A), 'reviewed_ok', 'no es culpa de la spec: no se rechaza');
  await writeFile(join(root, '.chalc', 'team.json'), JSON.stringify({ setup: 'node ok.js' }));
  const again = await team(root, 'integrate', '--feature', 'pagos');
  assert.deepEqual([again.code, again.text], [0, TEXT.es.integrated(A, 'chalc/int-pagos')]);
});

test('035 R1: se integra por olas, no por el orden en que se listaron', async (t) => {
  const { root } = await feature(t);
  for (const [spec, change] of [[A, { 'src/checkout/a.txt': 'a' }], [B, { 'src/recibos/b.txt': 'b' }]]) {
    await reviewedSpec(root, spec, change, { roles: [] });
    await appendEvent(root, { type: 'reviewed', spec, role: 'revisor', ok: true, findings: 0, summary: 'OK' });
  }
  // A pasa a una ola posterior a la de B: B se une primero.
  await appendEvent(root, { type: 'scheduled', spec: B, wave: 1 });
  await appendEvent(root, { type: 'reviewed', spec: B, role: 'revisor', ok: true, findings: 0, summary: 'OK' });
  await appendEvent(root, { type: 'scheduled', spec: A, wave: 2 });
  await appendEvent(root, { type: 'reviewed', spec: A, role: 'revisor', ok: true, findings: 0, summary: 'OK' });
  assert.equal((await team(root, 'integrate', '--feature', 'pagos')).code, 0);
  assert.deepEqual((await readLedger(root)).filter((e) => e.type === 'integrated').map((e) => e.spec), [B, A]);
});

test('035 R1: si el worktree de integración se borró pero la rama sigue, se vuelve a montar sobre ella', async (t) => {
  const { root, int } = await feature(t);
  await reviewedSpec(root, A, { 'src/checkout/a.txt': 'a' }, { roles: [] });
  await appendEvent(root, { type: 'reviewed', spec: A, role: 'revisor', ok: true, findings: 0, summary: 'OK' });
  assert.equal((await team(root, 'integrate', '--feature', 'pagos')).code, 0);
  assert.equal(intBranch('pagos'), 'chalc/int-pagos');
  assert.deepEqual([hasIntegration(root, 'pagos'), hasIntegration(root, 'otra')], [true, false]);
  assert.equal(await intDir(root, 'pagos'), int);
  assert.equal(git(root, 'worktree', 'remove', '--force', int).status, 0);
  const back = await ensureIntegration(root, 'pagos', 'HEAD');
  assert.deepEqual([back.ok, back.dir, back.err], [true, int, '']);
  assert.ok(existsSync(join(int, 'src', 'checkout', 'a.txt')), 'sobre la rama que ya tenía lo integrado');
  assert.deepEqual(await ensureIntegration(root, 'pagos', 'HEAD'), { ok: true, dir: int, err: '' });
  const bad = await ensureIntegration(root, 'nueva', 'no-existe-este-ref');
  assert.equal(bad.ok, false);
  assert.ok(bad.err.length > 0);
});

test('035 R4: enseñar a git a unir la evidencia es repetible y respeta lo que el usuario ya tenía', async (t) => {
  const root = await gitRepo(await tempDir(t, 'chalc-035-edges-'), { 'a.txt': 'x' });
  const file = join(root, '.git', 'info', 'attributes');
  await writeFiles(root, {});
  await rm(join(root, '.git', 'info'), { recursive: true, force: true });
  await evidenceMerges(root);
  const first = await readFile(file, 'utf8');
  assert.equal(first, '.chalc/review.md merge=union\n.chalc/tdd.jsonl merge=union\n.chalc/gate.md merge=chalc-keep\n.chalc/gate.state.json merge=chalc-keep\n');
  await evidenceMerges(root);
  assert.equal(await readFile(file, 'utf8'), first, 'la segunda vez no añade nada');
  assert.equal(git(root, 'config', '--get', 'merge.chalc-keep.driver').out, 'true');
  await writeFile(file, '*.png binary\n.chalc/review.md merge=union');
  await evidenceMerges(root);
  assert.equal(await readFile(file, 'utf8'), '*.png binary\n.chalc/review.md merge=union\n.chalc/tdd.jsonl merge=union\n.chalc/gate.md merge=chalc-keep\n.chalc/gate.state.json merge=chalc-keep\n');
});

test('032 R2: --root manda esté donde esté, y sin valor no cuenta', () => {
  const here = resolve('carpeta-que-no-es-repo-0001');
  assert.equal(mainRoot(here, ['--root', 'otra']), resolve(here, 'otra'));
  assert.equal(mainRoot(here, ['status', '--root', 'otra', 'x']), resolve(here, 'otra'));
  assert.equal(mainRoot(here, ['status', '--root']), here, 'sin valor, la carpeta actual (no existe: git falla)');
  assert.equal(mainRoot(here), here);
});

test('033 R1: formas menos habituales de declarar el alcance', () => {
  assert.deepEqual(planScope('  * **Toca:** `./src/a.ts`,src/b/ , \n').touches, ['src/a.ts', 'src/b']);
  assert.deepEqual(planScope('Toca:\n\n  - src/a.ts\n\n  * src/b.ts — nota\nDepende de:\n- ninguno\n').touches, ['src/a.ts', 'src/b.ts']);
  for (const nothing of ['-', '—', 'ninguna', 'Ninguno', 'nada', 'NONE', 'n/a']) assert.deepEqual(planScope(`Depende de: ${nothing}\n`).dependsOn, [], nothing);
  assert.deepEqual(planScope('Depende de: specs/027-a/, 028-b\n').dependsOn, ['027-a', '028-b']);
  assert.deepEqual(planScope('xToca: a\nToca : b\nTocar: c\ntocas: d\n').touches, ['b'], 'solo la etiqueta exacta, al empezar la línea');
  assert.deepEqual(planScope('Toca: a\r\nDepende de: 027-x\r\n'), { touches: ['a'], dependsOn: ['027-x'] });
  assert.deepEqual(planScope('Toca:\n- a\nTouches:\n- b\n').touches, ['a', 'b'], 'una etiqueta nueva cierra la lista anterior');
  assert.deepEqual(planScope('Toca:\ntexto suelto\n- no/cuenta\n').touches, []);
});

test('033 R1: rutas normalizadas, y comodines literales', () => {
  assert.deepEqual(['  ./././a/b//  ', 'a\\b\\', '/abs/x/'].map(normalPath), ['a/b', 'a/b', '/abs/x']);
  assert.equal(inScope('src/a.b.ts', ['src/*.ts']), true);
  assert.equal(inScope('src/axb/ts', ['src/a.b/ts']), false, 'el punto es un punto');
  assert.equal(inScope('src/x/y/z.test.ts', ['src/**/*.test.ts']), true);
  assert.equal(inScope('src/z.test.tsx', ['src/**/*.test.ts']), false);
  assert.equal(inScope('a/b', ['a/b/']), true);
  assert.equal(overlaps('./src/a/', 'src/a/b.ts'), true);
  assert.equal(overlaps('src//a', 'src/a/b'), true);
});

test('032 R9, 040 R6: `block` exige spec y un motivo que no esté en blanco; el informe sin galerías no las anuncia', async (t) => {
  const root = await tempDir(t, 'chalc-032-edges-');
  await writeFiles(root, { '.chalc/gate.json': JSON.stringify({ language: 'es' }) });
  const run = (...args) => team(root, ...args, '--root', root);
  await run('event', 'feature_opened', 'feature=pagos', 'agent=c');
  await run('event', 'spec_added', 'feature=pagos', `spec=${A}`);
  for (const args of [['block', '--spec', A, '   '], ['block', 'motivo sin spec'], ['block']]) assert.deepEqual([(await run(...args)).code, (await run(...args)).text], [1, TEXT.es.blockUsage], args.join('|'));
  assert.deepEqual([(await run('block', '--spec', A, 'falta la clave')).text], [TEXT.es.registered('blocked')]);
  assert.deepEqual([(await run('event', 'inventado')).text], [TEXT.es.refused('unknown-type')]);
  assert.deepEqual([(await run('report')).text], [TEXT.es.reportUsage]);
  assert.equal((await run('report', '--feature', 'pagos')).text.includes(TEXT.es.report.galleries), false);
  assert.equal((await run('report', '--feature', 'nadie')).code, 0);
});
