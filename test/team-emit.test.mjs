// Spec 032 (estado de equipo), T6 — equipar deja el orquestador en el repo (R1, R12): corre con Node a secas,
// su registro y su estado quedan fuera de git, y sus herramientas entran en la integridad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { equipForSpec } from '../lib/commands/equip.mjs';
import { TEAM_REL, emitTeam } from '../lib/teamemit.mjs';
import { integrityProblems } from '../catalog/gate/lib/integrity.mjs';
import { toolingDrift } from '../lib/tooldrift.mjs';
import { LOCAL_IGNORES } from '../lib/gitignore-local.mjs';

async function equipped(t) {
  const dir = await tempDir(t, 'chalc-032-emit-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  return dir;
}
const team = (dir, ...args) => spawnSync(process.execPath, [join('.chalc', 'team.mjs'), ...args], { cwd: dir, encoding: 'utf8', timeout: 60000 });

test('R1: emitTeam deja el lanzador y el árbol de herramientas', async (t) => {
  const dir = await tempDir(t, 'chalc-032-emit-');
  const { written } = await emitTeam(dir);
  assert.equal(TEAM_REL, '.chalc/team.mjs');
  for (const rel of ['.chalc/team.mjs', '.chalc/team/team.mjs', '.chalc/team/lib/reduce.mjs', '.chalc/team/lib/ledger.mjs']) assert.ok(written.includes(rel), rel);
});

test('R1: en un repo equipado, `node .chalc/team.mjs` corre con Node a secas', async (t) => {
  const dir = await equipped(t);
  const empty = team(dir, 'status');
  assert.equal(empty.status, 0, empty.stdout + empty.stderr);
  assert.match(empty.stdout, /Equipo/);
  assert.equal(team(dir, 'event', 'feature_opened', 'feature=pagos', 'agent=claude').status, 0);
  assert.match(team(dir, 'status').stdout, /pagos/);
  assert.equal(team(dir, 'inventado').status, 1);
});

test('R12: el registro y el estado quedan fuera de git; las herramientas, no', async (t) => {
  const dir = await equipped(t);
  for (const entry of ['.chalc/team/ledger.jsonl', '.chalc/team/status.json']) assert.ok(LOCAL_IGNORES.includes(entry), entry);
  const ignored = (await readFile(join(dir, '.gitignore'), 'utf8')).split(/\r?\n/);
  assert.ok(ignored.includes('.chalc/team/ledger.jsonl') && ignored.includes('.chalc/team/status.json'));
  assert.equal(ignored.includes('.chalc/team/'), false, 'la carpeta entera no: ahí viven las herramientas');
});

test('R12: las herramientas de equipo entran en la integridad y en la comparación con el catálogo', async (t) => {
  const dir = await equipped(t);
  const manifest = JSON.parse(await readFile(join(dir, '.chalc', 'integrity.json'), 'utf8'));
  assert.ok('.chalc/team/lib/reduce.mjs' in manifest.files && '.chalc/team.mjs' in manifest.files);
  team(dir, 'event', 'feature_opened', 'feature=pagos', 'agent=claude');
  assert.deepEqual(await integrityProblems(dir), [], 'el registro y el estado son datos, no herramientas');
  assert.deepEqual(await toolingDrift(dir), []);
  await writeFile(join(dir, '.chalc', 'team', 'lib', 'reduce.mjs'), '// alterado\n');
  assert.deepEqual((await integrityProblems(dir)).map((p) => p.file), ['.chalc/team/lib/reduce.mjs']);
  assert.deepEqual(await toolingDrift(dir), ['.chalc/team/lib/reduce.mjs']);
  assert.ok(existsSync(join(dir, '.chalc', 'team', 'ledger.jsonl')));
});
