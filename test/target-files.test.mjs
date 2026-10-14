// T1 (spec 021, R7) — un solo lugar dice qué archivos escribe cada target.
//
// Había dos tablas copiadas a mano —`lib/verify.mjs` y `cli/project.mjs`— con el comentario «VERIFICADO contra
// targets/*.mjs»: una verificación que nadie corría. Ahora hay una sola, y este test la contrasta con lo que cada
// target escribe de verdad al equipar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TARGET_LAYOUT, rulesFileOf } from '../lib/targetfiles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('R7: every target module has its row, and every row its module', async () => {
  const modules = (await readdir(join(ROOT, 'targets'))).filter((f) => f.endsWith('.mjs')).map((f) => f.replace('.mjs', '')).sort();
  assert.deepEqual(Object.keys(TARGET_LAYOUT).sort(), modules);
  assert.deepEqual(modules, ['antigravity', 'claude', 'codex', 'copilot', 'cursor']);
});

test('R1, R7: Claude keeps CLAUDE.md; every other harness reads AGENTS.md', () => {
  assert.equal(rulesFileOf('claude'), 'CLAUDE.md');
  for (const target of ['codex', 'copilot', 'cursor', 'antigravity']) assert.equal(rulesFileOf(target), 'AGENTS.md', target);
  assert.equal(rulesFileOf('gemini'), '', 'Gemini CLI was retired: no row');
  assert.equal(rulesFileOf('otro'), '');
});

// Lo que cada target escribe de verdad, con una skill y un MCP: el registro tiene que coincidir.
async function equipped(target) {
  const dir = await mkdtemp(join(tmpdir(), `chalc-layout-${target}-`));
  const catalog = join(dir, 'catalog');
  await mkdir(join(catalog, 'skills', 'demo'), { recursive: true });
  await writeFile(join(catalog, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Una skill de prueba.\n---\n# Demo\n');
  const proj = join(dir, 'proj');
  await mkdir(proj);
  const mod = await import(pathToFileURL(join(ROOT, 'targets', `${target}.mjs`)).href);
  const mcps = [{ id: 'fs', server: { command: 'npx', args: ['-y', 'x'] } }];
  await mod.apply({ projectPath: proj, CATALOG: catalog, skills: ['demo'], mcps, methods: [], stacks: [], architecture: null, specLang: 'es', dryRun: false, roles: [] });
  return proj;
}

for (const target of ['antigravity', 'claude', 'codex', 'copilot', 'cursor']) {
  test(`R7: ${target} writes exactly where the registry says`, async () => {
    const proj = await equipped(target);
    const layout = TARGET_LAYOUT[target];
    assert.ok(existsSync(join(proj, ...layout.rulesFile)), `rules: ${layout.rulesFile.join('/')}`);
    assert.ok(existsSync(join(proj, ...layout.skillsDir, 'demo', 'SKILL.md')), `skills: ${layout.skillsDir.join('/')}`);
    // El MCP: un archivo (no una carpeta) con el servidor bajo la clave y en el formato que dice el registro.
    const mcp = await readFile(join(proj, ...layout.mcpFile), 'utf8');
    if (layout.mcpFormat === 'toml') assert.match(mcp, new RegExp(`^\\[${layout.mcpKey}\\.fs\\]$`, 'm'));
    else assert.deepEqual(Object.keys(JSON.parse(mcp)[layout.mcpKey]), ['fs'], `mcp key: ${layout.mcpKey}`);
  });

  test(`R7: ${target} in a dry run writes nothing at all`, async () => {
    const dir = await mkdtemp(join(tmpdir(), `chalc-dry-${target}-`));
    const mod = await import(pathToFileURL(join(ROOT, 'targets', `${target}.mjs`)).href);
    const out = await mod.apply({ projectPath: dir, CATALOG: dir, skills: ['demo'], mcps: [{ id: 'fs', server: {} }], methods: [], stacks: [], architecture: null, specLang: 'es', dryRun: true, roles: [] });
    assert.equal(out.written, false);
    assert.deepEqual(await readdir(dir), []);
  });
}

test('R7: the only target with a non-JSON MCP file is Codex, in TOML', () => {
  assert.deepEqual(Object.entries(TARGET_LAYOUT).filter(([, l]) => l.mcpFormat).map(([t, l]) => [t, l.mcpFormat]), [['codex', 'toml']]);
});
