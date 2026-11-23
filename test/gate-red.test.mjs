// Spec 030 (rojo sellado), T1 — el rojo se registra con evidencia (R1–R4): tests que fallan antes de que exista
// el código de producción, con la huella de cada archivo de test. Un test se cambia haciéndolo fallar primero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { coherentSpec, coherentTexts } from './helpers/coherentspec.mjs';
import { main } from '../catalog/gate/gate.mjs';
import { TDD_REL, lastRed, readReds, registerRed, taskKeyOf } from '../catalog/gate/lib/tdd.mjs';
import { firstOpenTask } from '../catalog/gate/lib/specparse.mjs';
import { digestOf } from '../catalog/gate/lib/integrity.mjs';
import { FRAME } from '../catalog/gate/lib/i18n.mjs';

const DIR = 'specs/001-demo';
const CONFIG = { test: { command: 'npm test' }, spec: { dir: 'specs' }, language: 'es' };
const TEST_FILE = 'test/pago.test.mjs';
const at = (root, rel) => join(root, ...rel.split('/'));

async function project(t, { files = { [TEST_FILE]: 'assert.equal(pago(), 2);\n' }, config = CONFIG, texts = coherentTexts(['R1', 'R2']) } = {}) {
  const root = await tempDir(t, 'chalc-030-red-');
  const all = { '.chalc/gate.json': JSON.stringify(config), ...coherentSpec(DIR, { texts, red: false }), ...files };
  for (const [rel, content] of Object.entries(all)) { await mkdir(dirname(at(root, rel)), { recursive: true }); await writeFile(at(root, rel), content); }
  return root;
}
// El mundo inyectado: qué cambió la tarea y qué devuelve el comando de tests.
const world = (changed, code = 1) => ({ scope: async () => ({ files: changed, undetermined: false }), run: async () => ({ code, ms: 1 }), now: () => new Date('2026-11-22T10:00:00.000Z') });
const red = (root, changed = [TEST_FILE], code = 1, extra = {}) => registerRed(root, { ...world(changed, code), ...extra });
const KEY = `${DIR}#T1`;

test('la tarea en curso es la primera sin marcar, y su clave une la spec y el id de la tarea', () => {
  assert.equal(firstOpenTask('- [x] **T1** (R1) — a\n- [ ] **T2** (R2) — b\n- [ ] **T3** — c\n'), '**T2** (R2) — b');
  assert.equal(firstOpenTask('- [x] **T1** — a\n'), '');
  assert.equal(firstOpenTask(''), '');
  assert.equal(taskKeyOf(DIR, '**T2** (R2) — b'), `${DIR}#T2`);
  assert.equal(taskKeyOf(DIR, '**T10b** `[P]` (R2) — b'), `${DIR}#T10b`);
  assert.match(taskKeyOf(DIR, 'una tarea sin id'), new RegExp(`^${DIR}#t-[0-9a-f]{8}$`));
  assert.notEqual(taskKeyOf(DIR, 'una tarea sin id'), taskKeyOf(DIR, 'otra tarea sin id'));
  assert.equal(taskKeyOf(DIR, ''), '');
});

test('R1: con tests cambiados, sin código de producción y los tests fallando, registra el rojo con sus huellas', async (t) => {
  const root = await project(t);
  const out = await red(root);
  assert.equal(out.ok, true, out.reason);
  const record = { task: KEY, kind: 'red', date: '2026-11-22T10:00:00.000Z', tests: { [TEST_FILE]: digestOf('assert.equal(pago(), 2);\n') } };
  assert.deepEqual(out.record, record);
  assert.deepEqual(await readReds(root), [record]);
  assert.deepEqual(lastRed(await readReds(root), KEY), record);
});

test('R1: solo se sellan los archivos de test; lo demás del alcance no entra en el registro', async (t) => {
  const root = await project(t, { files: { [TEST_FILE]: 'a', 'test/otro.test.mjs': 'b', 'README.md': 'c' } });
  const out = await red(root, [TEST_FILE, 'test/otro.test.mjs', 'README.md']);
  assert.deepEqual(Object.keys(out.record.tests), [TEST_FILE, 'test/otro.test.mjs']);
});

test('R2: se niega, diciendo por qué, y no registra nada', async (t) => {
  const cases = [
    ['tests-pass', [TEST_FILE], 0],
    ['no-tests', ['README.md'], 1],
    ['no-tests', [], 1],
    ['code-first', [TEST_FILE, 'src/pago.mjs'], 1]
  ];
  for (const [reason, changed, code] of cases) {
    const root = await project(t, { files: { [TEST_FILE]: 'x', 'src/pago.mjs': 'y', 'README.md': 'z' } });
    const out = await red(root, changed, code);
    assert.deepEqual([out.ok, out.reason], [false, reason], reason);
    assert.equal(existsSync(at(root, TDD_REL)), false, reason);
  }
});

test('R2: «el código ya existe» se comprueba antes de correr los tests, y nombra los archivos', async (t) => {
  const root = await project(t, { files: { [TEST_FILE]: 'x', 'src/pago.mjs': 'y' } });
  let ran = false;
  const out = await registerRed(root, { ...world([TEST_FILE, 'src/pago.mjs']), run: async () => { ran = true; return { code: 1, ms: 1 }; } });
  assert.deepEqual([out.reason, ran], ['code-first', false]);
  assert.deepEqual(out.files, ['src/pago.mjs']);
});

test('R2: sin tarea en curso, sin comando de tests o sin saber qué cambió, también se niega', async (t) => {
  const done = coherentTexts(['R1']);
  const noTask = await project(t, { texts: { ...done, 'tasks.md': done['tasks.md'].replace('[ ]', '[x]') } });
  assert.equal((await red(noTask)).reason, 'no-task');
  const noCommand = await project(t, { config: { spec: { dir: 'specs' } } });
  assert.equal((await red(noCommand)).reason, 'no-test-command');
  const root = await project(t);
  assert.equal((await registerRed(root, { ...world([TEST_FILE]), scope: async () => ({ files: [], undetermined: true }) })).reason, 'scope-undetermined');
});

test('R3: con un rojo previo se puede volver a registrar aunque ya haya código, si los tests fallan otra vez', async (t) => {
  const root = await project(t, { files: { [TEST_FILE]: 'v1', 'src/pago.mjs': 'código' } });
  assert.equal((await red(root, [TEST_FILE])).ok, true);
  await writeFile(at(root, TEST_FILE), 'v2: nueva expectativa');
  const again = await red(root, [TEST_FILE, 'src/pago.mjs'], 1, { now: () => new Date('2026-11-22T11:00:00.000Z') });
  assert.equal(again.ok, true, again.reason);
  const reds = await readReds(root);
  assert.equal(reds.length, 2, 'el registro anterior se conserva');
  assert.equal(lastRed(reds, KEY).tests[TEST_FILE], digestOf('v2: nueva expectativa'));
  assert.equal((await red(root, [TEST_FILE, 'src/pago.mjs'], 0)).reason, 'tests-pass', 'aflojar el test para que pase no se puede sellar');
});

test('R3: el rojo de otra tarea no cuenta como rojo previo de esta', async (t) => {
  const root = await project(t, { files: { [TEST_FILE]: 'x', 'src/pago.mjs': 'y' } });
  await mkdir(dirname(at(root, TDD_REL)), { recursive: true });
  await writeFile(at(root, TDD_REL), JSON.stringify({ task: `${DIR}#T9`, kind: 'red', date: 'x', tests: {} }) + '\n');
  assert.equal((await red(root, [TEST_FILE, 'src/pago.mjs'])).reason, 'code-first');
});

test('R4: --skip con un motivo de tres palabras o más registra la exención; con menos, se niega', async (t) => {
  const root = await project(t);
  const out = await red(root, [], 1, { skip: 'solo cambia la documentación' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.record, { task: KEY, kind: 'skip', date: '2026-11-22T10:00:00.000Z', reason: 'solo cambia la documentación' });
  for (const skip of ['', 'porque sí', '   ']) assert.equal((await red(await project(t), [], 1, { skip })).reason, 'skip-reason', JSON.stringify(skip));
});

test('readReds ignora líneas rotas y un archivo que no existe', async (t) => {
  const root = await project(t);
  assert.deepEqual(await readReds(root), []);
  await mkdir(dirname(at(root, TDD_REL)), { recursive: true });
  await writeFile(at(root, TDD_REL), '{ roto\n' + JSON.stringify({ task: KEY, kind: 'red', date: 'd', tests: {} }) + '\n\n"texto"\n' + JSON.stringify({ kind: 'red' }) + '\n');
  assert.deepEqual((await readReds(root)).map((r) => r.task), [KEY]);
  assert.equal(lastRed([], KEY), null);
});

test('R1, R2: `gate.mjs --red` sale con 0 al registrar y con 1 al negarse, diciendo el motivo', async (t) => {
  const run = async (root, argv) => { const lines = []; return { code: await main({ argv: ['node', 'gate.mjs', ...argv], root, write: (l) => lines.push(l) }), text: lines.join('\n') }; };
  const noTask = await project(t, { texts: (() => { const x = coherentTexts(['R1']); return { ...x, 'tasks.md': x['tasks.md'].replace('[ ]', '[x]') }; })() });
  const refused = await run(noTask, ['--red']);
  assert.equal(refused.code, 1);
  assert.ok(refused.text.length > 10);
  const skipped = await run(await project(t), ['--red', '--skip', 'solo cambia la documentación']);
  assert.equal(skipped.code, 0, skipped.text);
  assert.equal((await run(await project(t), ['--red', '--skip', 'no'])).code, 1);
});

test('cada motivo de rechazo y cada resultado tienen su frase en es y en', () => {
  for (const lang of ['es', 'en']) {
    for (const key of ['done', 'skipped', 'noTask', 'noTests', 'testsPass', 'codeFirst', 'noTestCommand', 'scopeUndetermined', 'skipReason']) assert.ok(FRAME[lang].red[key], `${lang}.${key}`);
  }
});
