// Spec 027 (arranque limpio), T4 — la mutación lista al crear el proyecto (R5–R8): `chalc init` ofrece instalar
// la herramienta del stack y deja su configuración. Aquí no se instala nada: el paso que corre comandos se inyecta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { detectContext } from '../lib/detect.mjs';
import { repoTools } from '../lib/commands/equip.mjs';
import { installStep, mutationPlan } from '../lib/mutationsetup.mjs';
import { mutationWanted, runMutationStep } from '../lib/commands/mutationstep.mjs';
import { parseArgs } from '../lib/args.mjs';
import { DICT } from '../lib/i18n.mjs';

const JEST = { name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } };
const INSTALL = 'npm i -D @stryker-mutator/core @stryker-mutator/jest-runner';

async function project(t, { pkg = JEST, installed = false, config, lock } = {}) {
  const dir = await tempDir(t, 'chalc-027-mut-');
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg));
  if (lock) await writeFile(join(dir, lock), '');
  if (installed) {
    await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(dir, 'node_modules', '.bin', 'stryker'), '');
  }
  if (config !== undefined) await writeFile(join(dir, 'stryker.conf.json'), config);
  return dir;
}
const toolsOf = async (dir) => (await repoTools(dir, await detectContext(dir))).tools;
function runner(code = 0) {
  const calls = [];
  const runStep = async (step) => { calls.push(step); return { code }; };
  runStep.calls = calls;
  return runStep;
}
const step = async (dir, over = {}) => runMutationStep(dir, { want: true, dryRun: false, tools: await toolsOf(dir), runStep: runner(), ...over });

test('R5: el plan dice qué instalar, si ya está instalada y qué configuración falta', async (t) => {
  const dir = await project(t);
  assert.deepEqual(mutationPlan(dir, await toolsOf(dir)), { install: INSTALL, installed: false, configFile: 'stryker.conf.json', configMissing: true, config: (await toolsOf(dir)).equip.config });
  const ready = await project(t, { installed: true, config: '{}' });
  const plan = mutationPlan(ready, await toolsOf(ready));
  assert.deepEqual([plan.installed, plan.configMissing], [true, false]);
});

test('R5: sin herramienta de mutación con instalación no hay plan', async (t) => {
  const dir = await project(t, { pkg: { name: 'x', scripts: { test: 'node --test' } } });
  assert.equal(mutationPlan(dir, await toolsOf(dir)), null);
  assert.equal(mutationPlan(dir, null), null);
});

test('R5: el comando de instalación se parte en programa y argumentos, para correr en el proyecto', () => {
  assert.deepEqual(installStep(`  ${INSTALL}  `), { label: INSTALL, command: 'npm', args: ['i', '-D', '@stryker-mutator/core', '@stryker-mutator/jest-runner'], cwd: 'project' });
});

test('R5: aceptado, ejecuta la instalación del stack y lo cuenta', async (t) => {
  const dir = await project(t);
  const runStep = runner();
  const lines = await step(dir, { runStep });
  assert.deepEqual(runStep.calls.map((s) => [s.command, ...s.args].join(' ')), [INSTALL]);
  assert.ok(lines.some((line) => line.includes(INSTALL)));
});

test('R5: con el gestor del proyecto, instala con ese gestor', async (t) => {
  const dir = await project(t, { lock: 'pnpm-lock.yaml' });
  const runStep = runner();
  await step(dir, { runStep });
  assert.equal(runStep.calls[0].command, 'pnpm');
  assert.deepEqual(runStep.calls[0].args.slice(0, 2), ['add', '-D']);
});

test('R6: tras instalar escribe la configuración con el runner detectado y el reporte que lee el portón', async (t) => {
  const dir = await project(t);
  const lines = await step(dir);
  const config = JSON.parse(await readFile(join(dir, 'stryker.conf.json'), 'utf8'));
  assert.equal(config.testRunner, 'jest');
  assert.ok(config.reporters.includes('json'));
  assert.equal(config.jsonReporter.fileName, (await toolsOf(dir)).mutation.report);
  assert.ok(lines.some((line) => line.includes('stryker.conf.json')));
});

test('R6: una configuración que ya existe queda intacta', async (t) => {
  const dir = await project(t, { config: '{ "mio": true }' });
  await step(dir);
  assert.equal(await readFile(join(dir, 'stryker.conf.json'), 'utf8'), '{ "mio": true }');
});

test('R5: si ya está instalada no reinstala, pero sí deja la configuración que falte', async (t) => {
  const dir = await project(t, { installed: true });
  const runStep = runner();
  await step(dir, { runStep });
  assert.deepEqual(runStep.calls, []);
  assert.ok(existsSync(join(dir, 'stryker.conf.json')));
});

test('R7: si la instalación falla, avisa con el comando, no escribe la configuración y no lanza', async (t) => {
  const dir = await project(t);
  const lines = await step(dir, { runStep: runner(1) });
  assert.ok(lines.some((line) => line.includes(INSTALL)));
  assert.equal(existsSync(join(dir, 'stryker.conf.json')), false);
});

test('R8: en dry-run y con --no-mutation no se instala ni se escribe nada', async (t) => {
  const dir = await project(t);
  const runStep = runner();
  const dry = await step(dir, { dryRun: true, runStep });
  assert.equal(dry.length, 1, 'en seco dice lo que haría');
  assert.deepEqual(await step(dir, { want: false, runStep }), []);
  assert.deepEqual(runStep.calls, []);
  assert.equal(existsSync(join(dir, 'stryker.conf.json')), false);
});

test('R5: sin decisión (sin terminal ni flag) no instala, pero dice cómo', async (t) => {
  const dir = await project(t);
  const runStep = runner();
  const lines = await step(dir, { want: null, runStep });
  assert.deepEqual(runStep.calls, []);
  assert.ok(lines.some((line) => line.includes('--mutation')));
  const ready = await project(t, { installed: true, config: '{}' });
  assert.deepEqual(await step(ready, { want: null }), [], 'con todo listo no hay nada que decir');
});

test('R5: el flag manda; sin flag pregunta solo quien tiene terminal, con «sí» por defecto', async () => {
  assert.equal(await mutationWanted({ flag: true }), true);
  assert.equal(await mutationWanted({ flag: false, prompter: { yesno: async () => true } }), false);
  assert.equal(await mutationWanted({}), null);
  const asked = [];
  assert.equal(await mutationWanted({ prompter: { yesno: async (q, def) => { asked.push(def); return false; } } }), false);
  assert.deepEqual(asked, [true]);
});

test('R5, R8: --mutation y --no-mutation son flags booleanos conocidos', () => {
  assert.equal(parseArgs(['init', '--mutation']).flags.mutation, true);
  assert.equal(parseArgs(['init', '--no-mutation']).flags.mutation, false);
});

test('los textos del paso existen en es y en', () => {
  for (const lang of ['es', 'en']) {
    for (const key of ['initMutationQ', 'initMutationInstalled', 'initMutationFailed', 'initMutationConfig', 'initMutationDry', 'initMutationHint']) {
      assert.ok(DICT[lang][key], `${lang}.${key}`);
    }
  }
});
