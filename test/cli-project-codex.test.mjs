// F-01 — un proyecto equipado para Codex se abre en `chalc-cli` con sus skills, reglas y MCP.
//
// Integración de punta a punta: el target de Codex equipa el proyecto y la sesión recupera esos
// mismos recursos. Antes Codex no tenía layout y caía al de Claude: skills en `.claude/skills`, sin
// reglas y sin MCP.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as codex from '../targets/codex.mjs';
import { inspectProject, readMcpServers, parseTomlMcpServers } from '../cli/project.mjs';

const CATALOG = fileURLToPath(new URL('../catalog', import.meta.url));

test('codex-equipped projects expose their skills, rules and MCP servers to the CLI', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'chalc-f01-'));
  await writeFile(join(projectPath, '.codex-user-note'), '');
  const mcps = [{ id: 'demo', description: 'x', server: { command: 'npx', args: ['-y', 'demo-mcp'], env: { 'LOG.LEVEL': 'debug' } } }];
  await codex.apply({ projectPath, CATALOG, skills: ['clean-code'], mcps, methods: [], stacks: [], roles: [], dryRun: false });

  const p = await inspectProject(projectPath);
  assert.equal(p.target, 'codex');
  assert.equal(p.paths.skillsDir, join(projectPath, '.chalc', 'skills'));
  assert.equal(p.paths.rulesFile, join(projectPath, 'AGENTS.md'));
  assert.ok(p.detected.skills.some((s) => (s.id || s) === 'clean-code'), JSON.stringify(p.detected.skills));
  assert.deepEqual(p.detected.mcpServers, ['demo']);
  assert.deepEqual((await readMcpServers(p.paths)).demo, mcps[0].server);
});

test('the TOML reader tolerates user content outside the chalc subset', () => {
  const text = `model = "o3"\n[profiles.fast]\nmodel = 'x'\n\n# chalc:start\n[mcp_servers.a]\ncommand = "npx"\nargs = ["-y", "a"]\nenabled = true\n\n[mcp_servers.a.env]\nKEY = "v"\n# chalc:end\n[mcp_servers."b c"]\ncommand = 'literal'\nweird = """multi"""\n`;
  assert.deepEqual(parseTomlMcpServers(text), {
    a: { command: 'npx', args: ['-y', 'a'], enabled: true, env: { KEY: 'v' } },
    'b c': { command: 'literal' }
  });
});
