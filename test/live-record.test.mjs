// T2 (spec 020, R8, R9) — el hook que escribe el registro de actividad.
//
// Corre dentro del turno del agente, en `PreToolUse`: no puede imprimir NADA (una salida ahí se leería como
// una decisión sobre la acción), tiene que salir siempre con 0 y no puede colgarse esperando stdin. Añade una
// línea por evento y recorta el archivo para que no crezca sin fin.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { recordActivity } from '../catalog/live/record.mjs';
import { ACTIVITY_REL } from '../catalog/live/lib/activity.mjs';

const RECORD = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'catalog', 'live', 'record.mjs');
const project = () => mkdtemp(join(tmpdir(), 'chalc-live-record-'));
const read = async (root) => (await readFile(join(root, ACTIVITY_REL), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const event = (root, over = {}) => JSON.stringify({ hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Read', tool_input: { file_path: join(root, 'src/a.ts') }, ...over });

test('R8: each event adds one line to .chalc/activity.jsonl', async () => {
  const root = await project();
  await recordActivity(root, event(root));
  await recordActivity(root, event(root, { agent_type: 'revisor', tool_name: 'Grep', tool_input: { pattern: 'x' } }));
  const lines = await read(root);
  assert.deepEqual(lines.map((l) => [l.who, l.tool, l.summary]), [['principal', 'Read', 'src/a.ts'], ['revisor', 'Grep', 'x']]);
});

test('R9: an unreadable or ignored event writes nothing', async () => {
  const root = await project();
  for (const text of ['', '{{{', JSON.stringify({ hook_event_name: 'Notification' })]) assert.equal(await recordActivity(root, text), null);
  assert.ok(!existsSync(join(root, ACTIVITY_REL)));
});

test('R8: the file is cut back to the last lines when it grows past the cap', async () => {
  const root = await project();
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, ACTIVITY_REL), Array.from({ length: 10 }, (_, i) => JSON.stringify({ n: i })).join('\n') + '\n');
  await recordActivity(root, event(root), { max: 4 });
  const lines = await read(root);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.slice(0, 3).map((l) => l.n), [7, 8, 9]);
  assert.equal(lines[3].tool, 'Read');
});

function run({ stdin, cwd, env = {} }) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [RECORD], { cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env }, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    const timer = setTimeout(() => child.kill(), 5000);
    child.on('close', (code) => { clearTimeout(timer); done({ code, out }); });
    if (stdin !== undefined) child.stdin.end(stdin);
  });
}

test('R9: as a hook it prints nothing and exits 0, also on garbage and without stdin', async () => {
  const root = await project();
  for (const stdin of [event(root), '{{{', undefined]) {
    assert.deepEqual(await run({ stdin, cwd: root, env: { CLAUDE_PROJECT_DIR: root } }), { code: 0, out: '' }, String(stdin));
  }
  assert.equal((await read(root)).length, 1);
});

test('R8: the registry goes to the project root (CLAUDE_PROJECT_DIR), not to where the shell is', async () => {
  const root = await project();
  const src = join(root, 'src');
  await mkdir(src);
  await run({ stdin: event(root), cwd: src, env: { CLAUDE_PROJECT_DIR: root } });
  assert.ok(existsSync(join(root, ACTIVITY_REL)));
  assert.ok(!existsSync(join(src, ACTIVITY_REL)));
});
