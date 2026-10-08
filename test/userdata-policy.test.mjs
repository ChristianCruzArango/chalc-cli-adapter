// F-11 — una sola política: lo ilegible se respalda, lo que se reemplaza se copia antes, y lo que
// es del usuario no se pisa en silencio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMcpServers, copySkills, cleanPrefixed, mdc } from '../lib/targetkit.mjs';
import { writeKeepingPrevious, readJsonOrKeep } from '../lib/userdata.mjs';
import { writeSideSpec } from '../lib/commands/spec.mjs';
import { emitGate } from '../lib/gateemit.mjs';
import { rememberWorkspaceDir } from '../lib/workspace.mjs';
import { learnSynonym, LEARNED_REL } from '../catalog/memory/lib/concepts.mjs';
import { writeDebateOutput } from '../lib/commands/debate.mjs';

const CATALOG = fileURLToPath(new URL('../catalog', import.meta.url));
const tmp = (p) => mkdtemp(join(tmpdir(), `chalc-f11-${p}-`));
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };
const backups = async (root) => (existsSync(join(root, '.chalc', 'backups')) ? readdir(join(root, '.chalc', 'backups'), { recursive: true }) : []);

test('a user MCP server with the same id is kept, unless --force', async () => {
  const root = await tmp('mcp');
  const file = join(root, '.mcp.json');
  await writeFile(file, JSON.stringify({ mcpServers: { db: { command: 'mine', env: { TOKEN: '${MY}' } }, other: { command: 'x' } } }));
  const kept = await quiet(() => mergeMcpServers(file, [{ id: 'db', server: { command: 'chalc' } }, { id: 'new', server: { command: 'n' } }]));
  const j = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(kept, ['db']);
  assert.equal(j.mcpServers.db.command, 'mine');
  assert.equal(j.mcpServers.new.command, 'n');
  assert.equal(j.mcpServers.other.command, 'x');
  await mergeMcpServers(file, [{ id: 'db', server: { command: 'chalc' } }], { force: true });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).mcpServers.db.command, 'chalc');
});

test('MCP paths are written relative, not with this machine absolute path', async () => {
  const def = JSON.parse(await readFile(join(CATALOG, 'mcp', 'postgres.json'), 'utf8'));
  assert.match(JSON.stringify(def), /\$\{PROJECT\}/);
  const apply = await readFile(fileURLToPath(new URL('../lib/commands/apply.mjs', import.meta.url)), 'utf8');
  const equip = await readFile(fileURLToPath(new URL('../lib/commands/equip.mjs', import.meta.url)), 'utf8');
  for (const src of [apply, equip]) assert.equal(/PROJECT: proj\b/.test(src), false);
});

test('regenerating a spec keeps the previous tasks.md (with its ticks) in backups', async () => {
  const root = await tmp('spec');
  const first = await writeSideSpec(root, 'alta', { 'tasks.md': '- [x] T1 hecho\n- [ ] T2' });
  await quiet(() => writeSideSpec(root, 'alta', { 'tasks.md': '- [ ] T1\n- [ ] T2\n- [ ] T3' }));
  const copies = (await backups(root)).filter((f) => f.includes('tasks.md.'));
  assert.equal(copies.length, 1);
  assert.match(await readFile(join(root, '.chalc', 'backups', copies[0]), 'utf8'), /\[x\] T1 hecho/);
  assert.match(await readFile(join(first.dest, 'tasks.md'), 'utf8'), /T3/);
  await writeKeepingPrevious(root, join(first.dest, 'tasks.md'), await readFile(join(first.dest, 'tasks.md'), 'utf8'));
  assert.equal((await backups(root)).filter((f) => f.includes('tasks.md.')).length, 1);   // mismo contenido: sin copia
});

test('a corrupt gate.json is backed up before falling back to detection', async () => {
  const root = await tmp('gate');
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), '{ "test": { "command": "npm run mi-test" ');
  await quiet(() => emitGate(root));
  const saved = (await readdir(join(root, '.chalc'))).find((f) => f.startsWith('gate.json.invalid-'));
  assert.ok(saved);
  assert.match(await readFile(join(root, '.chalc', saved), 'utf8'), /mi-test/);
});

test('the global config is written atomically with owner-only permissions and a corrupt one is kept', async () => {
  const dir = await tmp('cfg');
  const file = join(dir, 'config.json');
  await writeFile(file, '{ "apiKey": "sk-x", ');
  await quiet(() => rememberWorkspaceDir('/w', file));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).workspaceDir, '/w');
  assert.ok((await readdir(dir)).some((f) => f.startsWith('config.json.invalid-')));
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('learned concepts survive a corrupt dictionary (it is backed up) and are written atomically', async () => {
  const root = await tmp('mem');
  await mkdir(join(root, '.chalc', 'memory'), { recursive: true });
  await writeFile(join(root, LEARNED_REL), '{ "dinero": { "synonyms": ["plata"] ');
  await learnSynonym(root, 'dinero', 'lana');
  const files = await readdir(join(root, '.chalc', 'memory'));
  assert.ok(files.some((f) => f.startsWith('concepts.json.invalid-')));
  assert.equal(files.some((f) => f.endsWith('.tmp')), false);
});

test('debate --out refuses to overwrite a previous debate unless --force', async () => {
  const out = await tmp('debate');
  const state = { idea: 'x', turns: [], disagreements: [] };
  await writeFile(join(out, 'final.md'), 'debate anterior');
  await assert.rejects(() => writeDebateOutput({ root: out, out, state, meta: {} }), /--force/);
  assert.equal(await readFile(join(out, 'final.md'), 'utf8'), 'debate anterior');
});

test('a homonymous user skill is backed up and replaced cleanly, not merged', async () => {
  const root = await tmp('skills');
  const dest = join(root, '.claude', 'skills');
  await mkdir(join(dest, 'clean-code'), { recursive: true });
  await writeFile(join(dest, 'clean-code', 'MINE.md'), 'mi skill');
  await quiet(() => copySkills(CATALOG, ['clean-code'], dest, { projectPath: root }));
  assert.equal(existsSync(join(dest, 'clean-code', 'MINE.md')), false);
  assert.ok((await backups(root)).some((f) => f.endsWith('MINE.md')));
  await copySkills(CATALOG, ['clean-code'], dest, { projectPath: root });   // ya es de chalc: sin copia nueva
  assert.equal((await backups(root)).filter((f) => f.endsWith('MINE.md')).length, 1);
});

test('only chalc-marked Cursor rules are removed silently; others are backed up first', async () => {
  const root = await tmp('mdc');
  const rules = join(root, '.cursor', 'rules');
  await mkdir(rules, { recursive: true });
  await writeFile(join(rules, 'chalc-skill-x.mdc'), mdc({ description: 'x', body: 'gen' }));
  await writeFile(join(rules, 'chalc-mia.mdc'), 'regla escrita a mano');
  await writeFile(join(rules, 'otra.mdc'), 'no se toca');
  await quiet(() => cleanPrefixed(rules, 'chalc-', '.mdc', { projectPath: root }));
  assert.deepEqual(await readdir(rules), ['otra.mdc']);
  const saved = (await backups(root)).filter((f) => f.includes('chalc-'));
  assert.equal(saved.length, 1);
  assert.match(saved[0], /chalc-mia\.mdc/);
});

test('readJsonOrKeep returns the fallback for a missing file without warnings', async () => {
  assert.deepEqual(await readJsonOrKeep(join(await tmp('none'), 'x.json'), { a: 1 }), { a: 1 });
});
