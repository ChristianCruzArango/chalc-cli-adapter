// Spec 030 (rojo sellado), T2 — la etapa `tdd` del portón (R5–R8): con código de producción cambiado exige el
// rojo registrado de la tarea, y que los tests sellados sigan intactos. Añadir tests después sí se permite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { coherentSpec } from './helpers/coherentspec.mjs';
import { runGate } from '../catalog/gate/gate.mjs';
import { tddStage } from '../catalog/gate/lib/tddstage.mjs';
import { digestOf } from '../catalog/gate/lib/integrity.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { FRAME, MESSAGES } from '../catalog/gate/lib/i18n.mjs';

const DIR = 'specs/001-demo';
const KEY = `${DIR}#T1`;
const TEST = 'test/pago.test.mjs';
const SRC = 'src/pago.mjs';
const CONFIG = { test: { command: 'npm test' }, mutation: { required: false }, spec: { dir: 'specs' }, language: 'es' };
const at = (root, rel) => join(root, ...rel.split('/'));
const redLine = (tests, over = {}) => JSON.stringify({ task: KEY, kind: 'red', date: '2026-11-22T10:00:00.000Z', tests, ...over }) + '\n';

async function project(t, { tdd, files = { [TEST]: 'v1', [SRC]: 'código' } } = {}) {
  const root = await tempDir(t, 'chalc-030-tdd-');
  const all = { '.chalc/gate.json': JSON.stringify(CONFIG), ...coherentSpec(DIR, { red: false }), ...files };
  if (tdd !== undefined) all['.chalc/tdd.jsonl'] = tdd;
  for (const [rel, content] of Object.entries(all)) { await mkdir(dirname(at(root, rel)), { recursive: true }); await writeFile(at(root, rel), content); }
  return root;
}
const stage = (root, files = [TEST, SRC]) => tddStage(root, { files, specDir: 'specs' });
const found = (s) => s.findings.map((f) => [f.file, f.rule]);

test('R5: con código de producción y el rojo registrado con sus tests intactos, la etapa pasa', async (t) => {
  const s = await stage(await project(t, { tdd: redLine({ [TEST]: digestOf('v1') }) }));
  assert.deepEqual([s.stage, s.ok, s.blocked, s.findings], ['tdd', true, false, []]);
});

test('R5: con código de producción y sin rojo registrado, falla nombrando la tarea', async (t) => {
  const s = await stage(await project(t));
  assert.equal(s.ok, false);
  assert.deepEqual(s.findings, [{ file: `${DIR}/tasks.md`, line: 1, rule: RULES.noRed, data: { task: KEY } }]);
});

test('R5: el rojo de OTRA tarea no vale, y una exención con código tampoco', async (t) => {
  const other = await stage(await project(t, { tdd: redLine({}, { task: `${DIR}#T9` }) }));
  assert.deepEqual(found(other), [[`${DIR}/tasks.md`, RULES.noRed]]);
  const skipped = await stage(await project(t, { tdd: JSON.stringify({ task: KEY, kind: 'skip', date: 'd', reason: 'solo cambia la documentación' }) + '\n' }));
  assert.deepEqual(skipped.findings, [{ file: `${DIR}/tasks.md`, line: 1, rule: RULES.redSkippedWithCode, data: { task: KEY, reason: 'solo cambia la documentación' } }]);
});

test('R6: un test sellado que cambió o desapareció se reporta con su archivo', async (t) => {
  const root = await project(t, { files: { [TEST]: 'v1 aflojado', 'test/otro.test.mjs': 'x', [SRC]: 'código' }, tdd: redLine({ [TEST]: digestOf('v1'), 'test/otro.test.mjs': digestOf('x'), 'test/borrado.test.mjs': digestOf('y') }) });
  const s = await stage(root);
  assert.equal(s.ok, false);
  assert.deepEqual(found(s), [[TEST, RULES.sealedTestChanged], ['test/borrado.test.mjs', RULES.sealedTestChanged]]);
});

test('R6: vale el ÚLTIMO rojo: volver a registrarlo con el test nuevo lo resuelve', async (t) => {
  const tdd = redLine({ [TEST]: digestOf('v1') }) + redLine({ [TEST]: digestOf('v2') }, { date: '2026-11-22T11:00:00.000Z' });
  const s = await stage(await project(t, { files: { [TEST]: 'v2', [SRC]: 'código' }, tdd }));
  assert.equal(s.ok, true);
});

test('R6: el fin de línea de un test sellado no cuenta como cambio', async (t) => {
  const s = await stage(await project(t, { files: { [TEST]: 'a\r\nb\r\n', [SRC]: 'c' }, tdd: redLine({ [TEST]: digestOf('a\nb\n') }) }));
  assert.equal(s.ok, true);
});

test('R7: añadir archivos de test después del rojo no se reporta', async (t) => {
  const root = await project(t, { files: { [TEST]: 'v1', 'test/nuevo.test.mjs': 'más casos', [SRC]: 'código' }, tdd: redLine({ [TEST]: digestOf('v1') }) });
  assert.equal((await stage(root, [TEST, 'test/nuevo.test.mjs', SRC])).ok, true);
});

test('R8: sin código de producción cambiado la etapa no aplica, haya o no rojo', async (t) => {
  for (const files of [[TEST], ['README.md'], [], ['.claude/skills/x/run.mjs']]) {
    const s = await stage(await project(t), files);
    assert.deepEqual([s.ok, s.skipped, s.reason, s.findings], [true, true, 'no-source', []], JSON.stringify(files));
  }
});

test('R8: sin tarea en curso (todo marcado) tampoco aplica', async (t) => {
  const root = await project(t);
  await writeFile(at(root, `${DIR}/tasks.md`), '# Tasks\n\n- [x] **T1** (R1) — hecho\n');
  assert.equal((await stage(root)).skipped, true);
  await rm(at(root, `${DIR}/tasks.md`));
  assert.equal((await stage(root)).skipped, true);
});

test('R5: el portón corre la etapa también con --fast, y sin rojo no aprueba', async (t) => {
  const run = async () => ({ code: 0, ms: 1 });
  const without = await runGate({ root: await project(t), fast: true, changed: [TEST, SRC], run });
  assert.ok(without.stages.some((s) => s.stage === 'tdd' && !s.ok));
  assert.equal(without.verdict, 'fail');
  const withRed = await runGate({ root: await project(t, { tdd: redLine({ [TEST]: digestOf('v1') }) }), fast: true, changed: [TEST, SRC], run });
  assert.ok(withRed.stages.some((s) => s.stage === 'tdd' && s.ok && !s.skipped));
});

test('cada hallazgo y la etapa tienen su texto en es y en', () => {
  for (const lang of ['es', 'en']) {
    assert.ok(FRAME[lang].stages.tdd, lang);
    assert.match(MESSAGES[lang][RULES.noRed]({ task: KEY }, lang), /--red/);
    assert.match(MESSAGES[lang][RULES.sealedTestChanged]({}, lang), /--red/);
    assert.ok(MESSAGES[lang][RULES.redSkippedWithCode]({ task: KEY, reason: 'x y z' }, lang).includes('x y z'));
  }
});
