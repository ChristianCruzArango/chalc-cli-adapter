// spec 021 (R1, R3, R9) — lo que cada target ANUNCIA antes de escribir: su plan, línea por línea.
//
// El plan es lo que el usuario lee en `--dry-run` para decidir: si dice un archivo y se escribe otro, engaña.
// Se fija entero por target. Las líneas de método salen del mismo `methodPlanLine` (dependen del idioma de la CLI).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as kit from '../lib/targetkit.mjs';
import * as antigravity from '../targets/antigravity.mjs';
import * as codex from '../targets/codex.mjs';
import * as copilot from '../targets/copilot.mjs';
import * as cursor from '../targets/cursor.mjs';

const METHOD = { id: 'sdd', label: 'SDD', mode: 'lite', rulesText: 'x' };
const args = (projectPath) => ({ projectPath, CATALOG: projectPath, skills: ['demo'], mcps: [{ id: 'fs', server: {} }], methods: [METHOD], stacks: [], architecture: null, specLang: 'es', dryRun: true, roles: [] });
const planOf = async (mod) => (await mod.apply(args(await mkdtemp(join(tmpdir(), 'chalc-plan-'))))).plan;
const method = kit.methodPlanLine(METHOD);

test('R1, R9: Codex and Copilot announce skills, MCP, method, AGENTS.md, the command and the manifest', async () => {
  assert.deepEqual(await planOf(codex), ['skill     .chalc/skills/demo', 'mcp       .codex/config.toml  ::  fs', method, 'rules     AGENTS.md', 'command   .agents/skills/chalc-live/SKILL.md', 'manifest  .chalc.json']);
  assert.deepEqual(await planOf(copilot), ['skill     .chalc/skills/demo', 'mcp       .vscode/mcp.json  ::  fs', method, 'rules     AGENTS.md', 'command   .github/prompts/chalc-live.prompt.md', 'manifest  .chalc.json']);
});

test('R3, R4, R9: Antigravity and Cursor announce their own places', async () => {
  assert.deepEqual(await planOf(antigravity), ['skill     .agents/skills/demo', 'mcp       .agents/mcp_config.json  ::  fs', method, 'rules     AGENTS.md', 'command   .agents/skills/chalc-live/SKILL.md', 'manifest  .chalc.json']);
  assert.deepEqual(await planOf(cursor), ['skill     .cursor/rules/chalc-skill-demo.mdc  (+ .chalc/skills/demo)', method, 'mcp       .cursor/mcp.json  ::  fs', 'rules     AGENTS.md', 'command   .cursor/commands/chalc-live.md', 'manifest  .chalc.json']);
});

test('R7: Copilot declares its MCP servers as stdio, keeping the rest of each server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-plan-'));
  await copilot.apply({ ...args(dir), dryRun: false, skills: [], mcps: [{ id: 'fs', server: { command: 'npx' } }] });
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.vscode', 'mcp.json'), 'utf8')).servers.fs, { type: 'stdio', command: 'npx' });
});

test('R4: Cursor rules for skills are not always applied: they load by description', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-plan-'));
  await mkdir(join(dir, 'skills', 'demo'), { recursive: true });
  await writeFile(join(dir, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Una demo.\n---\n');
  await cursor.apply({ ...args(dir), dryRun: false, mcps: [] });
  assert.match(await readFile(join(dir, '.cursor', 'rules', 'chalc-skill-demo.mdc'), 'utf8'), /alwaysApply: false/);
});
