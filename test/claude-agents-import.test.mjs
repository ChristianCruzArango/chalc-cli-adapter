// T6 (spec 021, R5) — Claude sigue con CLAUDE.md, y si el proyecto tiene AGENTS.md lo importa.
//
// Claude Code lee CLAUDE.md; con los dos archivos, solo CLAUDE.md, salvo que este importe `@AGENTS.md`
// (documentación oficial). Si AGENTS.md ya lleva el bloque de chalc —el repo también está equipado para otro
// harness—, repetirlo en CLAUDE.md le daría las reglas dos veces: se importa y se añade solo lo propio de Claude.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as claude from '../targets/claude.mjs';
import { END, START } from '../lib/targetkit/formats.mjs';

const METHOD = { id: 'sdd', label: 'SDD', mode: 'lite', rulesText: '## ⚙️ Método SDD\nReglas del método.' };

async function equip(agents) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-claude-import-'));
  const catalog = join(dir, 'catalog');
  await mkdir(join(catalog, 'skills', 'demo'), { recursive: true });
  await writeFile(join(catalog, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Demo.\n---\n');
  const proj = join(dir, 'proj');
  await mkdir(proj);
  if (agents !== undefined) await writeFile(join(proj, 'AGENTS.md'), agents);
  await claude.apply({ projectPath: proj, CATALOG: catalog, skills: ['demo'], mcps: [], methods: [METHOD], stacks: [], architecture: null, specLang: 'es', dryRun: false, roles: [] });
  return readFile(join(proj, 'CLAUDE.md'), 'utf8');
}

test('R5: without AGENTS.md, CLAUDE.md carries the whole chalc block, and imports nothing', async () => {
  const text = await equip();
  assert.match(text, /Método SDD/);
  assert.doesNotMatch(text, /@AGENTS\.md/);
});

test('R5: with the user\'s own AGENTS.md, CLAUDE.md keeps the whole block and imports it', async () => {
  const text = await equip('# Reglas del equipo\nUsa tabs.\n');
  assert.match(text, /Método SDD/);
  assert.match(text, /^@AGENTS\.md$/m);
});

test('R5: with the chalc block already in AGENTS.md, CLAUDE.md imports it and adds only what is Claude\'s own', async () => {
  const text = await equip(`${START}\n## ⚙️ Chalc\n## ⚙️ Método SDD\nReglas del método.\n${END}\n`);
  assert.match(text, /^@AGENTS\.md$/m);
  assert.doesNotMatch(text, /Método SDD/, 'the method rules are not repeated');
  assert.match(text, /`demo`/, 'the active Claude skills are still named');
});

// El bloque se fija entero en el caso en que más se recorta: el import en su propia línea, y lo propio de Claude.
test('R5: the exact block when AGENTS.md already carries chalc', async () => {
  const text = await equip(`${START}\n## ⚙️ Chalc\n${END}\n`);
  const block = text.slice(text.indexOf(START), text.indexOf(END) + END.length);
  assert.equal(block, [START, '## ⚙️ Chalc', '', '@AGENTS.md', '', '### Skills activas', '- `demo`', END].join('\n'));
});

test('R5: AGENTS.md counts as carrying chalc by its start marker', async () => {
  const text = await equip(`Texto ${START} suelto`);
  assert.doesNotMatch(text, /Método SDD/);
});
