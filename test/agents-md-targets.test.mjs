// T3 (spec 021, R1, R3, R4, R6) — Copilot, Cursor y Antigravity escriben AGENTS.md, y quitan su bloque viejo.
//
// Todos leen hoy `AGENTS.md` (documentación oficial de cada uno). Un proyecto equipado antes tiene el bloque de
// chalc en `GEMINI.md` (lo lee Antigravity), `.github/copilot-instructions.md` o en reglas `chalc-*.mdc`: al re-equipar, ese bloque se
// quita —si no, el harness leería las reglas dos veces— y lo que escribió el usuario se queda.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { END, START } from '../lib/targetkit/formats.mjs';
import * as antigravity from '../targets/antigravity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OLD_BLOCK = `${START}\n## ⚙️ Chalc\n- regla vieja\n${END}`;
const ROLE = { id: 'revisor', order: 10, cadence: 'task', required: true, summary: { es: 'Revisa la tarea.', en: 'Reviews the task.' }, tools: [] };

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-agentsmd-'));
  const catalog = join(dir, 'catalog');
  await mkdir(join(catalog, 'skills', 'demo'), { recursive: true });
  await writeFile(join(catalog, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Una skill de prueba.\n---\n# Demo\n');
  await mkdir(join(catalog, 'agents'), { recursive: true });
  await mkdir(join(catalog, 'agents', 'revisor'), { recursive: true });
  for (const f of ['agent.md', 'agent.en.md']) await writeFile(join(catalog, 'agents', 'revisor', f), '# Revisor\nRevisa.\n');
  const proj = join(dir, 'proj');
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(proj, rel)), { recursive: true });
    await writeFile(join(proj, rel), text);
  }
  await mkdir(proj, { recursive: true });
  return { proj, catalog };
}

async function equip(target, files) {
  const { proj, catalog } = await project(files);
  const mod = await import(pathToFileURL(join(ROOT, 'targets', `${target}.mjs`)).href);
  await mod.apply({ projectPath: proj, CATALOG: catalog, skills: ['demo'], mcps: [], methods: [{ id: 'sdd', label: 'SDD', mode: 'lite', rulesText: '## ⚙️ Método SDD\nReglas.' }], stacks: [], architecture: null, specLang: 'es', dryRun: false, roles: [ROLE] });
  return proj;
}
const read = (proj, rel) => readFile(join(proj, rel), 'utf8');

for (const target of ['copilot', 'cursor', 'antigravity']) {
  test(`R1: ${target} writes the chalc block, with the method and the roles, in AGENTS.md`, async () => {
    const proj = await equip(target);
    const agents = await read(proj, 'AGENTS.md');
    assert.ok(agents.includes(START) && agents.includes(END), target);
    assert.match(agents, /Método SDD/, target);
    assert.match(agents, /🔍 Agente revisor/, target);
  });
}

// Antigravity lee también GEMINI.md: el bloque de chalc de una versión anterior (target gemini, ya retirado) se quita.
test('R3, R6: Antigravity removes the old chalc block from GEMINI.md and keeps what the user wrote there', async () => {
  const proj = await equip('antigravity', { 'GEMINI.md': `# Mis notas para Gemini\n\n${OLD_BLOCK}\n` });
  assert.equal(await read(proj, 'GEMINI.md'), '# Mis notas para Gemini\n');
  assert.ok((await read(proj, 'AGENTS.md')).includes(START));
});

test('R3, R6: a GEMINI.md that only had the chalc block is gone', async () => {
  const proj = await equip('antigravity', { 'GEMINI.md': `${OLD_BLOCK}\n` });
  assert.ok(!existsSync(join(proj, 'GEMINI.md')));
});

test('R6: Copilot removes its old block from copilot-instructions.md and keeps the rest', async () => {
  const proj = await equip('copilot', { '.github/copilot-instructions.md': `Usa tabs.\n\n${OLD_BLOCK}\n` });
  assert.equal(await read(proj, '.github/copilot-instructions.md'), 'Usa tabs.\n');
});

test('R4, R6: Cursor keeps only one rule per skill; old chalc rules go, the user\'s own rules stay', async () => {
  const proj = await equip('cursor', {
    '.cursor/rules/chalc-method-sdd.mdc': 'viejo', '.cursor/rules/chalc-profile.mdc': 'viejo', '.cursor/rules/chalc-principles.mdc': 'viejo',
    '.cursor/rules/chalc-revisor.mdc': 'viejo', '.cursor/rules/mia.mdc': '---\nalwaysApply: true\n---\nMía.\n'
  });
  assert.deepEqual((await readdir(join(proj, '.cursor', 'rules'))).sort(), ['chalc-skill-demo.mdc', 'mia.mdc']);
  assert.match(await read(proj, '.cursor/rules/chalc-skill-demo.mdc'), /description: Una skill de prueba\./);
  assert.equal(await read(proj, '.cursor/rules/mia.mdc'), '---\nalwaysApply: true\n---\nMía.\n');
});

// T5 (R3): Antigravity — AGENTS.md, skills en .agents/skills (las carga solo, como Claude) y MCP en .agents/mcp_config.json.
test('R3: Antigravity writes AGENTS.md pointing its skills at .agents/skills, and its MCP config', async () => {
  const { proj, catalog } = await project({ '.agents/mcp_config.json': JSON.stringify({ mcpServers: { mio: { command: 'yo' } } }) });
  const mod = antigravity;
  assert.equal(mod.label, 'Antigravity');
  await mod.apply({ projectPath: proj, CATALOG: catalog, skills: ['demo'], mcps: [{ id: 'fs', server: { command: 'npx' } }], methods: [], stacks: [], architecture: null, specLang: 'es', dryRun: false, roles: [ROLE] });
  const agents = await read(proj, 'AGENTS.md');
  assert.match(agents, /`\.agents\/skills\/demo\/SKILL\.md`/);
  assert.doesNotMatch(agents, /\.chalc\/skills/);
  assert.match(agents, /🔍 Agente revisor/);
  assert.ok(existsSync(join(proj, '.agents', 'skills', 'demo', 'SKILL.md')));
  assert.deepEqual(Object.keys(JSON.parse(await read(proj, '.agents/mcp_config.json')).mcpServers).sort(), ['fs', 'mio']);
  assert.equal(JSON.parse(await read(proj, '.chalc.json')).target, 'antigravity');
});

test('R3: the Antigravity plan names what it will write, and a dry run writes nothing', async () => {
  const { proj, catalog } = await project();
  const mod = antigravity;
  const { plan, written } = await mod.apply({ projectPath: proj, CATALOG: catalog, skills: ['demo'], mcps: [{ id: 'fs', server: {} }], methods: [], stacks: [], architecture: null, specLang: 'es', dryRun: true, roles: [] });
  assert.equal(written, false);
  assert.ok(plan.some((l) => l.includes('.agents/skills/demo')) && plan.some((l) => l.includes('.agents/mcp_config.json')) && plan.some((l) => l.includes('AGENTS.md')));
  assert.ok(!existsSync(join(proj, 'AGENTS.md')));
});
