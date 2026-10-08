// F-17 — con chalc instalado como paquete, lo que el usuario añade va a ~/.chalc y se superpone al
// catálogo: nada se escribe dentro del paquete (EACCES con `npm i -g`, y se perdía con `npm update`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writableLayout, skillDir, mcpFile, skillIds, mcpIds } from '../lib/userstore.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOG = join(ROOT, 'catalog');

async function withHome(fn) {
  const previous = process.env.CHALC_HOME;
  process.env.CHALC_HOME = await mkdtemp(join(tmpdir(), 'chalc-f17-'));
  try { return await fn(process.env.CHALC_HOME); } finally {
    if (previous === undefined) delete process.env.CHALC_HOME; else process.env.CHALC_HOME = previous;
  }
}

test('an installed package writes to the user layer, a git checkout keeps writing to the catalog', async () => {
  const pkg = await mkdtemp(join(tmpdir(), 'chalc-f17-pkg-'));
  await mkdir(join(pkg, 'catalog')); await mkdir(join(pkg, 'rules'));
  const saved = process.env.CHALC_HOME;
  delete process.env.CHALC_HOME;
  try {
    assert.equal(writableLayout(pkg).overlay, true);                 // sin .git: paquete instalado
    await mkdir(join(pkg, '.git'));
    assert.deepEqual(writableLayout(pkg), { catalog: join(pkg, 'catalog'), rules: join(pkg, 'rules'), lockRoot: pkg, overlay: false });
  } finally { if (saved !== undefined) process.env.CHALC_HOME = saved; }
});

test('user skills and MCP shadow the package ones with the same id and are listed together', () => withHome(async (home) => {
  await mkdir(join(home, 'catalog', 'skills', 'clean-code'), { recursive: true });
  await mkdir(join(home, 'catalog', 'skills', 'mi-skill'), { recursive: true });
  await mkdir(join(home, 'catalog', 'mcp'), { recursive: true });
  await writeFile(join(home, 'catalog', 'mcp', 'mio.json'), '{"id":"mio","server":{"command":"x"}}');
  assert.equal(skillDir(CATALOG, 'clean-code'), join(home, 'catalog', 'skills', 'clean-code'));
  assert.equal(skillDir(CATALOG, 'solid-principles'), join(CATALOG, 'skills', 'solid-principles'));
  assert.equal(mcpFile(CATALOG, 'mio'), join(home, 'catalog', 'mcp', 'mio.json'));
  assert.ok(skillIds(CATALOG).includes('mi-skill') && skillIds(CATALOG).includes('angular-developer'));
  assert.ok(mcpIds(CATALOG).includes('mio') && mcpIds(CATALOG).includes('postgres'));
}));

test('wiring a skill to a package rule writes a copy in ~/.chalc and leaves the package untouched', () => withHome(async (home) => {
  const before = await readFile(join(ROOT, 'rules', 'angular.json'), 'utf8');
  const { addSkillToRule } = await import('../lib/commands/configure.mjs');
  const { loadRules } = await import('../lib/commands/catalogstore.mjs');
  await addSkillToRule('angular', 'clean-code');
  await addSkillToRule('angular', 'mi-skill-nueva');
  assert.equal(await readFile(join(ROOT, 'rules', 'angular.json'), 'utf8'), before);
  const mine = JSON.parse(await readFile(join(home, 'rules', 'angular.json'), 'utf8'));
  assert.ok(mine.skills.includes('mi-skill-nueva'));
  const merged = (await loadRules()).find((r) => r.id === 'angular');
  assert.ok(merged.skills.includes('mi-skill-nueva'));
  assert.equal((await loadRules()).filter((r) => r.id === 'angular').length, 1);
}));
