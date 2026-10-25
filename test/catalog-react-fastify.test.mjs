// T1 (spec 025, R1, R2) — las skills de React, Next.js, React Native, Fastify, Node y Vitest viajan con chalc
// (vendorizadas y bloqueadas con su fuente de skills.sh) y el MCP de Next.js fija su versión.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILLS = join(ROOT, 'catalog', 'skills');

// Skill → repositorio de origen en skills.sh (el lock debe apuntar a ese y no a una copia).
const VENDORED = {
  'vercel-react-best-practices': 'github.com/vercel-labs/agent-skills',
  'vercel-composition-patterns': 'github.com/vercel-labs/agent-skills',
  'vercel-react-native-skills': 'github.com/vercel-labs/agent-skills',
  'fastify-best-practices': 'github.com/mcollina/skills',
  node: 'github.com/mcollina/skills',
  vitest: 'github.com/antfu/skills'
};

test('R1: each skill is vendored with its SKILL.md and locked to its skills.sh source', async () => {
  const lock = JSON.parse(await readFile(join(ROOT, 'skills-lock.json'), 'utf8'));
  for (const [id, repo] of Object.entries(VENDORED)) {
    assert.ok(existsSync(join(SKILLS, id, 'SKILL.md')), `${id}: falta SKILL.md`);
    const entry = lock.skills[id];
    assert.ok(entry, `${id}: sin entrada en skills-lock.json`);
    assert.equal(entry.sourceType, 'skillssh', id);
    assert.ok(entry.source.includes(repo) && entry.source.includes(`--skill ${id}`), `${id}: ${entry.source}`);
  }
});

test('R2: the Next.js MCP runs a pinned next-devtools-mcp without secrets', async () => {
  const mcp = JSON.parse(await readFile(join(ROOT, 'catalog', 'mcp', 'next-devtools.json'), 'utf8'));
  assert.equal(mcp.id, 'next-devtools');
  assert.equal(mcp.requiresSecret, false);
  assert.equal(mcp.server.command, 'npx');
  assert.ok(mcp.server.args.some((a) => /^next-devtools-mcp@\d+\.\d+\.\d+$/.test(a)), mcp.server.args.join(' '));
});
