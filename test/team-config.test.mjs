// Spec 034 (roles y lanzadores), T1 — la configuración por rol (R4, R6): con qué lanzador y qué nivel de modelo
// corre cada uno. Lo que no se entiende cae al valor por defecto; un comando peligroso no se entrega.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { LAUNCHERS, TIERS, commandProblem, maxParallel, nextTier, readTeamConfig, resolveCommand, roleConfig } from '../catalog/team/lib/config.mjs';

test('R4: los valores posibles', () => {
  assert.deepEqual(TIERS, ['economico', 'medio', 'alto']);
  assert.deepEqual(LAUNCHERS, ['nativo', 'comando']);
});

test('R4: sin configuración, el desarrollador corre en nivel medio y quien juzga en alto, todos con lanzador nativo', () => {
  assert.deepEqual(roleConfig({}, 'desarrollador'), { launcher: 'nativo', tier: 'medio', command: '', skills: [] });
  for (const role of ['revisor', 'seguridad', 'analista', 'especificador', 'lider', 'endurecedor']) {
    assert.deepEqual(roleConfig({}, role), { launcher: 'nativo', tier: 'alto', command: '', skills: [] }, role);
  }
  assert.deepEqual(roleConfig(null, 'revisor').tier, 'alto');
});

test('R4: lo configurado manda; un lanzador o un nivel desconocidos caen al de por defecto', () => {
  const raw = { roles: {
    desarrollador: { launcher: 'comando', tier: 'economico', command: 'codex exec --file {orden}', skills: ['clean-code', 7, ''] },
    revisor: { launcher: 'telepatía', tier: 'máximo', command: 9, skills: 'no-lista' }
  } };
  assert.deepEqual(roleConfig(raw, 'desarrollador'), { launcher: 'comando', tier: 'economico', command: 'codex exec --file {orden}', skills: ['clean-code'] });
  assert.deepEqual(roleConfig(raw, 'revisor'), { launcher: 'nativo', tier: 'alto', command: '', skills: [] });
  assert.deepEqual(roleConfig({ roles: 'roto' }, 'revisor').launcher, 'nativo');
});

test('R11: el nivel siguiente, y ninguno por encima del más alto', () => {
  assert.deepEqual(['economico', 'medio', 'alto', 'raro'].map(nextTier), ['medio', 'alto', '', '']);
});

test('R8: el tope de paralelismo, 3 por defecto', () => {
  assert.deepEqual([{}, { maxParallel: 5 }, { maxParallel: 0 }, { maxParallel: 'x' }, { maxParallel: 2.5 }, null].map(maxParallel), [3, 5, 3, 3, 3, 3]);
});

test('R6: un comando tiene que nombrar la orden y no llevar nada que la shell de Windows rechace', () => {
  assert.equal(commandProblem('codex exec --file {orden}'), '');
  assert.equal(commandProblem('agy run {orden} --dir {carpeta}'), '');
  assert.equal(commandProblem(''), 'no-command');
  assert.equal(commandProblem('   '), 'no-command');
  assert.equal(commandProblem('codex exec'), 'no-order');
  for (const bad of ['a {orden} & b', 'a {orden} | b', 'a < {orden}', 'a {orden} > x', 'a ({orden})', 'a ^ {orden}', 'a %X% {orden}', 'a {orden}!', 'a {orden}\nb', 'a {orden}\rb']) {
    assert.equal(commandProblem(bad), 'unsafe-command', JSON.stringify(bad));
  }
});

test('R6: el comando resuelto lleva las rutas entre comillas', () => {
  assert.equal(resolveCommand('codex exec --file {orden} --cd {carpeta}', { order: '/r/.chalc/team/orders/027.desarrollador.md', dir: '/w t/027' }),
    'codex exec --file "/r/.chalc/team/orders/027.desarrollador.md" --cd "/w t/027"');
});

test('readTeamConfig: el archivo del repo, o un objeto vacío si no existe o está roto', async (t) => {
  const root = await tempDir(t, 'chalc-034-config-');
  assert.deepEqual(await readTeamConfig(root), {});
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'team.json'), '{ roto');
  assert.deepEqual(await readTeamConfig(root), {});
  await writeFile(join(root, '.chalc', 'team.json'), '[1]');
  assert.deepEqual(await readTeamConfig(root), {});
  await writeFile(join(root, '.chalc', 'team.json'), JSON.stringify({ maxParallel: 2 }));
  assert.deepEqual(await readTeamConfig(root), { maxParallel: 2 });
});
