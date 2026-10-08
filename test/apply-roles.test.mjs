// Todo rol que gate.json exige tiene que quedar instalado en el target.
//
// Encontrado en la prueba de punta a punta de la spec 014: `chalc` (apply) y `chalc init` escribían
// gate.json con sus roles —seguridad, revisor, endurecedor— pero no le pasaban los roles al target,
// así que no se instalaba ninguno. El advisor pedía `call_role` a un agente que el asistente no tenía,
// y la tarea se quedaba ahí para siempre. Solo `chalc spec-ia` y `chalc feature` los instalaban.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { equipCreatedProject } from '../lib/commands/equip.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'chalc.mjs');

async function jsProject() {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-apply-roles-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node --test' } }));
  return dir;
}

const runChalc = (args, cwd) => new Promise((done) => {
  execFile(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
    done({ code: error?.code ?? 0, output: `${stdout}${stderr}` });
  });
});

const declaredRoles = async (dir) => JSON.parse(await readFile(join(dir, '.chalc', 'gate.json'), 'utf8')).flow.roles.map((r) => r.id);

test('chalc (apply) installs every role gate.json requires, for Claude Code', async () => {
  const dir = await jsProject();
  const result = await runChalc([dir, '--target', 'claude', '--method', 'sdd', '--mode', 'lite', '--yes'], dir);
  assert.equal(result.code, 0, result.output);

  const roles = await declaredRoles(dir);
  assert.ok(roles.includes('seguridad'));
  for (const id of roles) {
    assert.ok(existsSync(join(dir, '.claude', 'agents', `${id}.md`)), `falta .claude/agents/${id}.md`);
    assert.match(result.output, new RegExp(`\\.claude/agents/${id}\\.md`), `el resumen no lista ${id}`);
  }
});

test('chalc (apply) installs every role gate.json requires, for Codex', async () => {
  const dir = await jsProject();
  const result = await runChalc([dir, '--target', 'codex', '--method', 'sdd', '--mode', 'lite', '--yes'], dir);
  assert.equal(result.code, 0, result.output);

  const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  for (const id of await declaredRoles(dir)) assert.match(agents, new RegExp(`Agente ${id}|${id} agent`), `AGENTS.md sin ${id}`);
});

test('chalc init (equipCreatedProject) installs every role gate.json requires', async () => {
  const dir = await jsProject();
  await equipCreatedProject(dir, { targetName: 'claude' });

  for (const id of await declaredRoles(dir)) {
    assert.ok(existsSync(join(dir, '.claude', 'agents', `${id}.md`)), `falta .claude/agents/${id}.md`);
  }
});
