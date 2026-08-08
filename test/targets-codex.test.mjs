import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as codex from '../targets/codex.mjs';
import { tomlMcpServers } from '../lib/targetkit.mjs';
import { loadTargets } from '../lib/commands/catalogstore.mjs';

// El directorio hace de proyecto y de catálogo mínimo a la vez. Incluye el agente revisor, que
// todos los targets proyectan desde el catálogo (spec 007, R12).
async function tmp() {
  const base = await mkdtemp(join(tmpdir(), 'chalc-codex-'));
  await mkdir(join(base, 'agents'), { recursive: true });
  for (const agent of ['revisor.md', 'revisor.en.md']) {
    await writeFile(join(base, 'agents', agent), 'Revisor. Skills:\n\n{{SKILLS}}\n', 'utf8');
  }
  return base;
}

const MCPS = [
  { id: 'dart', description: 'Dart MCP', server: { command: 'dart', args: ['mcp-server'] } },
  { id: 'db', description: '', server: { command: 'npx', args: ['-y', 'db-mcp'], env: { DB_URL: 'postgres://x' } } }
];

// R1 — codex se descubre como target de primera clase (todos los flujos usan loadTargets/import dinámico).
test('loadTargets discovers codex with the Codex CLI label', async () => {
  const targets = await loadTargets();
  const found = targets.find((tg) => tg.id === 'codex');
  assert.ok(found, `codex no está en: ${targets.map((tg) => tg.id).join(', ')}`);
  assert.equal(found.label, 'Codex CLI');
});

// R4 — serializador TOML puro: tablas [mcp_servers.<id>] con command/args y env como sub-tabla.
test('tomlMcpServers serializes command, args and env into mcp_servers tables', () => {
  const toml = tomlMcpServers(MCPS);
  assert.match(toml, /\[mcp_servers\.dart\]/);
  assert.match(toml, /command = "dart"/);
  assert.match(toml, /args = \["mcp-server"\]/);
  assert.match(toml, /\[mcp_servers\.db\.env\]/);
  assert.match(toml, /DB_URL = "postgres:\/\/x"/);
});

// R3 + R4 — apply: skills a .chalc/skills con referencia en AGENTS.md; MCP a .codex/config.toml.
test('codex apply writes AGENTS.md references and .codex/config.toml preserving user content', async () => {
  const base = await tmp();
  // catálogo mínimo con una skill real
  await mkdir(join(base, 'skills', 'clean-code'), { recursive: true });
  await writeFile(join(base, 'skills', 'clean-code', 'SKILL.md'),
    '---\nname: clean-code\ndescription: Código limpio siempre\n---\n\ncuerpo\n');
  // config.toml previo del usuario: NO se debe tocar fuera del bloque
  await mkdir(join(base, '.codex'), { recursive: true });
  await writeFile(join(base, '.codex', 'config.toml'), 'model = "gpt-5.5"\n', 'utf8');

  await codex.apply({ projectPath: base, CATALOG: base, skills: ['clean-code'], mcps: MCPS, methods: [], stacks: [], dryRun: false });

  const agents = await readFile(join(base, 'AGENTS.md'), 'utf8');
  assert.match(agents, /clean-code/);
  assert.match(agents, /\.chalc\/skills\/clean-code\/SKILL\.md/);
  assert.ok(existsSync(join(base, '.chalc', 'skills', 'clean-code', 'SKILL.md')), 'skill copiada');

  const toml = await readFile(join(base, '.codex', 'config.toml'), 'utf8');
  assert.match(toml, /model = "gpt-5\.5"/);           // lo del usuario sigue ahí
  assert.match(toml, /\[mcp_servers\.dart\]/);
  assert.match(toml, /\[mcp_servers\.db\]/);
});

// R4 — re-aplicar reemplaza SOLO el bloque gestionado: sin tablas duplicadas.
test('codex apply is idempotent on .codex/config.toml (no duplicated tables)', async () => {
  const base = await tmp();
  const opts = { projectPath: base, CATALOG: base, skills: [], mcps: MCPS, methods: [], stacks: [], dryRun: false };
  await codex.apply(opts);
  await codex.apply(opts);
  const toml = await readFile(join(base, '.codex', 'config.toml'), 'utf8');
  assert.equal(toml.match(/\[mcp_servers\.dart\]/g).length, 1);
});

// R6 — dry-run: plan sin escribir nada.
test('codex apply with dryRun returns the plan and writes nothing', async () => {
  const base = await tmp();
  const res = await codex.apply({ projectPath: base, CATALOG: base, skills: ['clean-code'], mcps: MCPS, methods: [], stacks: [], dryRun: true });
  assert.equal(res.written, false);
  assert.ok(res.plan.some((p) => p.includes('AGENTS.md')));
  assert.ok(res.plan.some((p) => p.includes('.codex/config.toml')));
  assert.ok(!existsSync(join(base, 'AGENTS.md')));
  assert.ok(!existsSync(join(base, '.codex')));
});
