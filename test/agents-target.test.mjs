// T8 (spec 022, R19, C1) — los targets que leen AGENTS.md comparten UNA secuencia de equipado
// (`applyAgentsTarget`), parametrizada por su fila de TARGET_LAYOUT: ninguno puede olvidar un paso.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAgentsTarget } from '../lib/targetkit/agentstarget.mjs';
import { liveCommandFile } from '../lib/targetkit/livecommand.mjs';
import { TARGET_LAYOUT } from '../lib/targetfiles.mjs';
import { START } from '../lib/targetkit/formats.mjs';
import { tempDir } from './helpers/tmpdir.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MCPS = [{ id: 'fs', description: 'd', server: { command: 'npx', args: ['x'] } }];

async function setup(t) {
  const dir = await tempDir(t, 'chalc-agents-target-');
  const CATALOG = join(dir, 'catalog');
  await mkdir(join(CATALOG, 'skills', 'demo'), { recursive: true });
  await writeFile(join(CATALOG, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Demo.\n---\n');
  const projectPath = join(dir, 'proj');
  await mkdir(projectPath);
  return { projectPath, CATALOG, skills: ['demo'], mcps: MCPS, methods: [], stacks: [], architecture: null, specLang: 'en', roles: [] };
}

test('C1: el plan por defecto sale de la fila del layout, y en seco no escribe nada', async (t) => {
  const opts = await setup(t);
  const out = await applyAgentsTarget('copilot', { ...opts, dryRun: true });
  assert.deepEqual(out, { written: false, plan: [
    'skill     .chalc/skills/demo', 'mcp       .vscode/mcp.json  ::  fs', 'rules     AGENTS.md',
    `command   ${liveCommandFile('copilot')}`, 'manifest  .chalc.json'
  ] });
  assert.ok(!existsSync(join(opts.projectPath, 'AGENTS.md')));
});

test('C1: equipar escribe los siete pasos donde dice el layout (skills, bloque, comando, MCP, manifiesto)', async (t) => {
  for (const target of ['codex', 'antigravity']) {
    const opts = await setup(t);
    const out = await applyAgentsTarget(target, { ...opts, dryRun: false });
    const layout = TARGET_LAYOUT[target];
    const at = (...p) => join(opts.projectPath, ...p);
    assert.equal(out.written, true);
    assert.ok(existsSync(at(...layout.skillsDir, 'demo', 'SKILL.md')), target);
    const agents = await readFile(at('AGENTS.md'), 'utf8');
    assert.ok(agents.includes(START) && agents.includes(`${layout.skillsDir.join('/')}/demo/SKILL.md`), target);
    assert.ok(existsSync(at(liveCommandFile(target))), target);
    assert.match(await readFile(at(...layout.mcpFile), 'utf8'), /fs/, target);
    assert.equal(JSON.parse(await readFile(at('.chalc.json'), 'utf8')).target, target);
  }
});

test('C1: los ganchos del target corren en su sitio (servidores MCP propios, archivos heredados)', async (t) => {
  const opts = await setup(t);
  const legacy = join(opts.projectPath, 'OLD.md');
  await writeFile(legacy, 'mío\n\n<!-- chalc:start -->\nx\n<!-- chalc:end -->\n');
  const calls = [];
  await applyAgentsTarget('cursor', { ...opts, dryRun: false }, {
    legacyFiles: [['OLD.md']],
    mcpServers: (mcps) => mcps.map((m) => ({ ...m, server: { ...m.server, tag: 1 } })),
    beforeSkills: async () => calls.push('before'),
    afterCommand: async () => calls.push('after')
  });
  assert.deepEqual(calls, ['before', 'after']);
  assert.ok(!(await readFile(legacy, 'utf8')).includes('chalc:start'));
  assert.equal(JSON.parse(await readFile(join(opts.projectPath, '.cursor', 'mcp.json'), 'utf8')).mcpServers.fs.tag, 1);
});

test('C1: los cuatro targets de AGENTS.md delegan en applyAgentsTarget y no repiten la secuencia', async () => {
  for (const target of ['codex', 'copilot', 'cursor', 'antigravity']) {
    const src = await readFile(join(ROOT, 'targets', `${target}.mjs`), 'utf8');
    assert.match(src, /applyAgentsTarget\(/, target);
    for (const step of ['writeManifest', 'chalcBlock', 'writeLiveCommand', 'copyMethodScaffolds']) {
      assert.ok(!src.includes(step), `${target} no debe repetir ${step}`);
    }
  }
});

test('C1: el bloque TOML de Codex no deja líneas en blanco antes del cierre, y sin MCP no crea archivo de MCP', async (t) => {
  const opts = await setup(t);
  await applyAgentsTarget('codex', { ...opts, dryRun: false });
  const toml = await readFile(join(opts.projectPath, '.codex', 'config.toml'), 'utf8');
  assert.match(toml, /\n\[mcp_servers\.fs\][\s\S]*\S\n# chalc:end/);
  const bare = await setup(t);
  await applyAgentsTarget('cursor', { ...bare, mcps: [], dryRun: false });
  assert.ok(!existsSync(join(bare.projectPath, '.cursor', 'mcp.json')));
});

test('C1: sin --force se conserva el servidor MCP que el usuario ya configuró', async (t) => {
  const opts = await setup(t);
  const file = join(opts.projectPath, '.cursor', 'mcp.json');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ mcpServers: { fs: { command: 'mío' } } }));
  await applyAgentsTarget('cursor', { ...opts, dryRun: false });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).mcpServers.fs.command, 'mío');
});

test('C1: las skills llevan la marca en el idioma del spec, sea cual sea el de la CLI', async (t) => {
  const { blockText } = await import('../lib/targetkit/blocktext.mjs');
  for (const specLang of ['es', 'en']) {
    const opts = await setup(t);
    await applyAgentsTarget('codex', { ...opts, specLang, dryRun: false });
    const mark = await readFile(join(opts.projectPath, '.chalc', 'skills', 'demo', '.chalc-managed'), 'utf8');
    assert.ok(mark.includes(blockText(specLang).managedNote), specLang);
  }
});

test('C1: Copilot quita el bloque de chalc de su archivo antiguo y marca sus servidores como stdio', async (t) => {
  const copilot = await import('../targets/copilot.mjs');
  const opts = await setup(t);
  const legacy = join(opts.projectPath, '.github', 'copilot-instructions.md');
  await mkdir(dirname(legacy), { recursive: true });
  await writeFile(legacy, 'mío\n\n<!-- chalc:start -->\nx\n<!-- chalc:end -->\n');
  await copilot.apply({ ...opts, dryRun: false });
  assert.equal((await readFile(legacy, 'utf8')).trim(), 'mío');
  assert.equal(JSON.parse(await readFile(join(opts.projectPath, '.vscode', 'mcp.json'), 'utf8')).servers.fs.type, 'stdio');
  assert.equal(copilot.label, 'GitHub Copilot');
});

test('C1: Cursor retira solo sus reglas viejas y describe cada regla de skill (o la nombra si no hay descripción)', async (t) => {
  const cursor = await import('../targets/cursor.mjs');
  const opts = await setup(t);
  await mkdir(join(opts.CATALOG, 'skills', 'bare'), { recursive: true });
  await writeFile(join(opts.CATALOG, 'skills', 'bare', 'SKILL.md'), '---\nname: Bare\n---\n');
  const rules = join(opts.projectPath, '.cursor', 'rules');
  await mkdir(rules, { recursive: true });
  for (const f of ['chalc-old.mdc', 'mine.mdc', 'chalc-notes.txt']) await writeFile(join(rules, f), 'chalc:managed');
  await cursor.apply({ ...opts, skills: ['demo', 'bare'], dryRun: false });
  assert.ok(!existsSync(join(rules, 'chalc-old.mdc')));
  assert.ok(existsSync(join(rules, 'mine.mdc')) && existsSync(join(rules, 'chalc-notes.txt')));
  assert.match(await readFile(join(rules, 'chalc-skill-demo.mdc'), 'utf8'), /^description: Demo\.$/m);
  assert.match(await readFile(join(rules, 'chalc-skill-bare.mdc'), 'utf8'), /^description: Bare$/m);
  assert.equal(cursor.label, 'Cursor');
});
