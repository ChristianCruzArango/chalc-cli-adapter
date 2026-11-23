// Spec 042 (evals activos), T3 — `node .chalc/evals.mjs` (R1, R2, R5): preparar un caso en una carpeta limpia,
// puntuar lo que un agente dejó en ella y comparar corridas por etiqueta. chalc no lanza al agente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { writeFiles } from './helpers/teamrepo.mjs';
import { main } from '../catalog/evals/evals.mjs';
import { MESSAGES } from '../catalog/evals/lib/i18n.mjs';
import { equipForSpec } from '../lib/commands/equip.mjs';
import { LOCAL_IGNORES } from '../lib/gitignore-local.mjs';

async function project(t, language = 'es') {
  const root = await tempDir(t, 'chalc-042-cli-');
  await writeFiles(root, { '.chalc/gate.json': JSON.stringify({ language }) });
  return root;
}
const run = async (root, ...args) => { const lines = []; return { code: await main({ argv: ['node', 'evals.mjs', ...args], cwd: root, write: (l) => lines.push(l), launch: async () => null }), text: lines.join('\n') }; };
const results = async (root) => (await readFile(join(root, '.chalc', 'evals-out', 'results.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));

for (const lang of ['es', 'en']) {
  test(`R1 (${lang}): \`list\` muestra cada caso con su título y su trampa, en el idioma del proyecto`, async (t) => {
    const out = await run(await project(t, lang), 'list');
    assert.equal(out.code, 0);
    for (const id of ['test-aflojado', 'fuera-de-alcance', 'dato-inventado', 'botones-juntos']) assert.ok(out.text.includes(id), id);
    assert.ok(out.text.includes(lang === 'es' ? 'Lo más corto es cambiar el test' : 'The shortest path is changing the test'));
  });
}

test('R2: `prepare` deja el estado inicial y el encargo, y dice cómo seguir', async (t) => {
  const root = await project(t);
  const out = await run(root, 'prepare', 'test-aflojado', '--out', 'banco/uno');
  assert.equal(out.code, 0, out.text);
  const dir = join(root, 'banco', 'uno');
  for (const file of ['src/total.js', 'test/total.test.js', 'package.json']) assert.ok(existsSync(join(dir, ...file.split('/'))), file);
  const task = await readFile(join(dir, 'TASK.md'), 'utf8');
  assert.ok(task.includes('test/total.test.js') && task.includes('Déjalos en verde'));
  assert.equal(task.includes('Lo más corto es cambiar el test'), false, 'la trampa no se le cuenta a quien se evalúa');
  assert.ok(out.text.includes('score test-aflojado --dir'));
});

test('R2: no pisa una carpeta con contenido, y un caso que no existe se dice', async (t) => {
  const root = await project(t);
  await writeFiles(root, { 'ocupada/algo.txt': 'mío' });
  const busy = await run(root, 'prepare', 'test-aflojado', '--out', 'ocupada');
  assert.deepEqual([busy.code, busy.text], [1, MESSAGES.es.notEmpty('ocupada')]);
  assert.equal(await readFile(join(root, 'ocupada', 'algo.txt'), 'utf8'), 'mío');
  assert.deepEqual([(await run(root, 'prepare', 'no-existe', '--out', 'x')).text], [MESSAGES.es.unknownCase('no-existe')]);
  for (const args of [['prepare', 'test-aflojado'], ['prepare'], ['score', 'test-aflojado'], [], ['inventado']]) assert.deepEqual([(await run(root, ...args)).code, (await run(root, ...args)).text], [1, MESSAGES.es.usage], args.join(' '));
});

test('R3, R5: `score` puntúa la carpeta, lo explica comprobación por comprobación y guarda la corrida con su etiqueta', async (t) => {
  const root = await project(t);
  await run(root, 'prepare', 'dato-inventado', '--out', 'banco');
  const before = await run(root, 'score', 'dato-inventado', '--dir', 'banco', '--label', 'económico v1');
  assert.equal(before.code, 0);
  for (const piece of ['dice-que-falta', 'no-inventa', '5/10', '50 %']) assert.ok(before.text.includes(piece), `${piece}\n${before.text}`);
  await writeFile(join(root, 'banco', 'BLOCKED.md'), 'Falta la URL.\n');
  const after = await run(root, 'score', 'dato-inventado', '--dir', 'banco', '--label', 'económico v1');
  assert.ok(after.text.includes('10/10'));
  const saved = await results(root);
  assert.deepEqual(saved.map((r) => [r.case, r.label, r.earned, r.max, r.percent]), [['dato-inventado', 'económico v1', 5, 10, 50], ['dato-inventado', 'económico v1', 10, 10, 100]]);
  assert.match(saved[0].date, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(saved[0].checks.map((c) => [c.id, c.status]), [['dice-que-falta', 'fail'], ['no-inventa', 'pass']]);
});

test('R4: lo omitido se dice y no entra en la cuenta', async (t) => {
  const root = await project(t);
  await run(root, 'prepare', 'botones-juntos', '--out', 'banco');
  const out = await run(root, 'score', 'botones-juntos', '--dir', 'banco');
  assert.ok(out.text.includes(MESSAGES.es.statuses.skipped) && out.text.includes('0/5'), out.text);
  assert.equal((await results(root))[0].skipped, 1);
});

test('R5: `compare` muestra, por etiqueta y caso, las corridas y su media; sin corridas lo dice', async (t) => {
  const root = await project(t);
  assert.deepEqual([(await run(root, 'compare')).code, (await run(root, 'compare')).text], [0, MESSAGES.es.noRuns]);
  await run(root, 'prepare', 'dato-inventado', '--out', 'a');
  await run(root, 'score', 'dato-inventado', '--dir', 'a', '--label', 'medio');
  await writeFile(join(root, 'a', 'BLOCKED.md'), 'x');
  await run(root, 'score', 'dato-inventado', '--dir', 'a', '--label', 'medio');
  await run(root, 'score', 'dato-inventado', '--dir', 'a');
  const out = await run(root, 'compare');
  assert.equal(out.code, 0);
  assert.match(out.text, /medio\s+dato-inventado\s+2\s+75 %/);
  assert.ok(out.text.includes(MESSAGES.es.noLabel));
});

test('R1: equipar deja la herramienta con sus casos, entra en la integridad y sus resultados quedan fuera de git', async (t) => {
  const dir = await tempDir(t, 'chalc-042-emit-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  const manifest = JSON.parse(await readFile(join(dir, '.chalc', 'integrity.json'), 'utf8'));
  for (const file of ['.chalc/evals.mjs', '.chalc/evals/lib/checks.mjs', '.chalc/evals/cases/test-aflojado.json']) assert.ok(file in manifest.files, file);
  assert.ok(LOCAL_IGNORES.includes('.chalc/evals-out/'));
  const listed = spawnSync(process.execPath, [join('.chalc', 'evals.mjs'), 'list'], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /test-aflojado/);
});

test('paridad: los textos de los evals tienen las mismas claves en es y en', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(keys(MESSAGES.es), keys(MESSAGES.en));
});
