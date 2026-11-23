// Spec 030 (rojo sellado), T4 — cada requisito de la tarea con su test (R10). Que un test cite un requisito que
// existe ya se exigía; faltaba el otro sentido: que la tarea no deje un requisito suyo sin ningún test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { coherentSpec, coherentTexts } from './helpers/coherentspec.mjs';
import { untestedRequirements } from '../catalog/gate/lib/traceability.mjs';
import { runGate } from '../catalog/gate/gate.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { MESSAGES } from '../catalog/gate/lib/i18n.mjs';

const DIR = 'specs/001-demo';
const SRC = 'src/pago.mjs';
const at = (root, rel) => join(root, ...rel.split('/'));
const TASKS = '# Tasks\n\n- [ ] **T1** (R1, R2) — cobro y vencimiento\n- [ ] **T2** (R2) — otra\n';

async function project(t, files, tasks = TASKS) {
  const root = await tempDir(t, 'chalc-030-untested-');
  const texts = { ...coherentTexts(['R1', 'R2']), 'tasks.md': tasks };
  const all = { '.chalc/gate.json': JSON.stringify({ test: { command: 'npm test' }, mutation: { required: false }, spec: { dir: 'specs' }, language: 'es' }), ...coherentSpec(DIR, { texts }), [SRC]: 'código', ...files };
  for (const [rel, content] of Object.entries(all)) { await mkdir(dirname(at(root, rel)), { recursive: true }); await writeFile(at(root, rel), content); }
  return root;
}
const check = (root, files) => untestedRequirements(files, { root, specDir: 'specs' });

test('R10: un requisito de la tarea que ningún test cambiado cita se reporta con su id', async (t) => {
  const root = await project(t, { 'test/pago.test.mjs': "// R1\nit('cobra', () => { expect(cobra()).toBe(1); });\n" });
  assert.deepEqual(await check(root, [SRC, 'test/pago.test.mjs']), [{ file: `${DIR}/tasks.md`, line: 3, rule: RULES.requirementUntested, data: { id: 'R2', task: `${DIR}#T1` } }]);
});

test('R10: con todos los requisitos de la tarea citados en sus tests, entre varios archivos, no hay hallazgos', async (t) => {
  const root = await project(t, { 'test/a.test.mjs': '// R1\n', 'test/b.test.mjs': "test('R2: vence', () => {});\n" });
  assert.deepEqual(await check(root, [SRC, 'test/a.test.mjs', 'test/b.test.mjs']), []);
});

test('R10: R12 no cubre a R1, y un archivo que no es de test no cuenta', async (t) => {
  const root = await project(t, { 'test/a.test.mjs': '// R12 y R2\n', 'docs/notas.md': 'R1' });
  const found = await check(root, [SRC, 'test/a.test.mjs', 'docs/notas.md']);
  assert.deepEqual(found.map((f) => f.data.id), ['R1']);
});

test('R10: sin código de producción cambiado, sin tarea en curso o si la tarea no cita requisitos, no aplica', async (t) => {
  const root = await project(t, { 'test/a.test.mjs': 'x' });
  assert.deepEqual(await check(root, ['test/a.test.mjs', 'README.md']), []);
  const noReqs = await project(t, {}, '# Tasks\n\n- [ ] **T1** — sin requisitos\n');
  assert.deepEqual(await check(noReqs, [SRC]), []);
  const done = await project(t, {}, '# Tasks\n\n- [x] **T1** (R1, R2) — hecho\n');
  assert.deepEqual(await check(done, [SRC]), []);
});

test('R10: un test cambiado que ya no existe no rompe la comprobación', async (t) => {
  const root = await project(t, {});
  assert.deepEqual((await check(root, [SRC, 'test/borrado.test.mjs'])).map((f) => f.data.id), ['R1', 'R2']);
});

test('R10: el portón lo reporta en la etapa de trazabilidad', async (t) => {
  const root = await project(t, { 'test/pago.test.mjs': '// R1\n' });
  const result = await runGate({ root, fast: true, changed: [SRC, 'test/pago.test.mjs'], run: async () => ({ code: 0, ms: 1 }) });
  const stage = result.stages.find((s) => s.stage === 'traceability');
  assert.deepEqual(stage.findings.map((f) => [f.rule, f.data.id]), [[RULES.requirementUntested, 'R2']]);
});

test('el mensaje nombra el requisito y la tarea, en es y en', () => {
  for (const lang of ['es', 'en']) {
    const line = MESSAGES[lang][RULES.requirementUntested]({ id: 'R2', task: `${DIR}#T1` }, lang);
    assert.ok(line.includes('R2') && line.includes('T1'), lang);
  }
});
