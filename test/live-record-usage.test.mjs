// T13 (spec 020, R12) — el hook también cuenta los tokens y sabe en qué tarea va.
//
// En cada evento lee SOLO lo nuevo de los transcripts que nombra el evento (`transcript_path` de la sesión,
// `agent_transcript_path` del rol al salir), con un cursor por archivo en `.chalc/usage.json`, y lo carga a la
// tarea en curso. Los hooks de `PreToolUse` corren en paralelo cuando el agente lanza varias herramientas a la
// vez: el acumulado se escribe bajo un candado, y si no lo consigue, el turno sigue igual.

import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordActivity } from '../catalog/live/record.mjs';
import { ACTIVITY_REL } from '../catalog/live/lib/activity.mjs';
import { USAGE_REL } from '../catalog/live/lib/usage.mjs';
import { LOCK_REL, withLock } from '../catalog/live/lib/lock.mjs';
import { readNew } from '../catalog/live/lib/transcript.mjs';

const project = async (tasks = '- [x] **T1** (R1) — Hecha\n- [ ] **T2** (R2) — En curso\n') => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-live-usage-'));
  await mkdir(join(root, 'specs', '001-x'), { recursive: true });
  await writeFile(join(root, 'specs', '001-x', 'tasks.md'), tasks);
  return root;
};
const msg = (id, input, output) => `${JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: input, output_tokens: output } } })}\n`;
const usageFile = async (root) => JSON.parse(await readFile(join(root, USAGE_REL), 'utf8'));
const activity = async (root) => (await readFile(join(root, ACTIVITY_REL), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const tool = (over) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, ...over });

test('R12: USAGE_REL is .chalc/usage.json', () => {
  assert.equal(USAGE_REL, '.chalc/usage.json');
});

test('R12: each activity line says which task was in progress', async () => {
  const root = await project();
  await recordActivity(root, tool({}));
  assert.equal((await activity(root))[0].task, 'T2');
});

test('R12: with no pending task, or no tasks file, the line says no task', async () => {
  for (const root of [await project('- [x] **T1** — Hecha\n'), await mkdtemp(join(tmpdir(), 'chalc-live-usage-'))]) {
    await recordActivity(root, tool({}));
    assert.equal((await activity(root))[0].task, '');
  }
});

test('R12: the tokens of the session are charged to the task in progress, each message once', async () => {
  const root = await project();
  const transcript = join(root, 'session.jsonl');
  await writeFile(transcript, msg('m1', 10, 1) + msg('m1', 10, 1));
  const at1 = new Date('2026-10-13T10:00:00Z');
  await recordActivity(root, tool({ transcript_path: transcript }), { now: at1 });
  await appendFile(transcript, msg('m1', 10, 1) + msg('m2', 5, 2));
  await recordActivity(root, tool({ transcript_path: transcript }), { now: new Date('2026-10-13T10:03:00Z') });
  const { tasks } = await usageFile(root);
  assert.deepEqual(tasks.T2, { input: 15, output: 3, cacheRead: 0, cacheWrite: 0, firstAt: at1.toISOString(), lastAt: '2026-10-13T10:03:00.000Z' });
});

test('R12: a role\'s own transcript is counted when it finishes, and only once', async () => {
  const root = await project();
  const own = join(root, 'agent.jsonl');
  await writeFile(own, msg('a1', 100, 50));
  const stop = JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'revisor', agent_transcript_path: own });
  await recordActivity(root, stop);
  await recordActivity(root, stop);
  assert.deepEqual([(await usageFile(root)).tasks.T2.input, (await usageFile(root)).tasks.T2.output], [100, 50]);
});

test('R12: the same file named twice in one event is read once', async () => {
  const root = await project();
  const same = join(root, 's.jsonl');
  await writeFile(same, msg('m1', 7, 0));
  await recordActivity(root, JSON.stringify({ hook_event_name: 'Stop', transcript_path: same, agent_transcript_path: same }));
  assert.equal((await usageFile(root)).tasks.T2.input, 7);
});

test('R12: events with no transcript still mark the time of the task', async () => {
  const root = await project();
  await recordActivity(root, tool({}), { now: new Date('2026-10-13T10:00:00Z') });
  await recordActivity(root, tool({ transcript_path: join(root, 'no-existe.jsonl') }), { now: new Date('2026-10-13T10:01:00Z') });
  const t2 = (await usageFile(root)).tasks.T2;
  assert.deepEqual([t2.input, t2.firstAt, t2.lastAt], [0, '2026-10-13T10:00:00.000Z', '2026-10-13T10:01:00.000Z']);
});

test('R12: an event without transcripts leaves no cursor behind', async () => {
  const root = await project();
  await recordActivity(root, tool({ transcript_path: '', agent_transcript_path: 7 }));
  await recordActivity(root, tool({}));
  assert.deepEqual((await usageFile(root)).cursors, {});
});

test('R12: the task in progress comes from the spec folder set in gate.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-live-usage-'));
  await mkdir(join(root, '.chalc'), { recursive: true });
  await mkdir(join(root, 'docs', 'specs', '001-x'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ spec: { dir: 'docs/specs' } }));
  await writeFile(join(root, 'docs', 'specs', '001-x', 'tasks.md'), '- [ ] **T7** — Aquí\n');
  await recordActivity(root, tool({}));
  assert.equal((await activity(root))[0].task, 'T7');
});

test('R12: a broken usage file starts again instead of breaking the hook', async () => {
  const root = await project();
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, USAGE_REL), '{ roto');
  await recordActivity(root, tool({}));
  assert.deepEqual(Object.keys((await usageFile(root)).tasks), ['T2']);
});

test('R12: an ignored event touches neither the activity nor the usage', async () => {
  const root = await project();
  await recordActivity(root, JSON.stringify({ hook_event_name: 'Notification' }));
  assert.ok(!existsSync(join(root, USAGE_REL)));
});

// ── leer solo lo nuevo ────────────────────────────────────────────────────────────────────────

test('R12: only complete lines past the cursor are read, and the cursor moves to the end of them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-live-tail-'));
  const path = join(dir, 't.jsonl');
  await writeFile(path, 'uno\ndos\ntre');
  assert.deepEqual(await readNew(path, 0), { text: 'uno\ndos\n', offset: 8 });
  assert.deepEqual(await readNew(path, 8), { text: '', offset: 8 });
  assert.deepEqual(await readNew(path, 11), { text: '', offset: 11 });
  await appendFile(path, 's\n');
  assert.deepEqual(await readNew(path, 8), { text: 'tres\n', offset: 13 });
});

test('R12: a file that shrank (a new one in its place) is read from the start; a missing one is empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-live-tail-'));
  const path = join(dir, 't.jsonl');
  await writeFile(path, 'a\n');
  assert.deepEqual(await readNew(path, 50), { text: 'a\n', offset: 2 });
  assert.deepEqual(await readNew(join(dir, 'nada'), 3), { text: '', offset: 0 });
  assert.deepEqual(await readNew(path, -4), { text: 'a\n', offset: 2 });
});

test('R12: multi-byte text is cut by bytes, never in the middle of a character', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-live-tail-'));
  const path = join(dir, 't.jsonl');
  await writeFile(path, 'ñandú\nsí');
  const first = await readNew(path, 0);
  assert.deepEqual(first, { text: 'ñandú\n', offset: Buffer.byteLength('ñandú\n') });
});

// ── el candado ────────────────────────────────────────────────────────────────────────────────

test('R12: the lock runs the work, releases it, and returns its result', async () => {
  const root = await project();
  assert.equal(LOCK_REL, '.chalc/usage.lock');
  assert.equal(await withLock(root, async () => 'hecho'), 'hecho');
  assert.ok(!existsSync(join(root, LOCK_REL)));
});

test('R12: the lock is released even if the work fails', async () => {
  const root = await project();
  await assert.rejects(withLock(root, async () => { throw new Error('x'); }), /x/);
  assert.ok(!existsSync(join(root, LOCK_REL)));
});

test('R12: two at once take turns instead of overwriting each other', async () => {
  const root = await project();
  const order = [];
  const slow = (name) => withLock(root, async () => { order.push(`${name}+`); await new Promise((r) => setTimeout(r, 30)); order.push(`${name}-`); });
  await Promise.all([slow('a'), slow('b')]);
  assert.ok(['a+,a-,b+,b-', 'b+,b-,a+,a-'].includes(order.join(',')), order.join(','));
});

test('R12: a held lock is waited for a while, then given up (the work does not run)', async () => {
  const root = await project();
  await mkdir(join(root, LOCK_REL), { recursive: true });
  let ran = false;
  assert.equal(await withLock(root, async () => { ran = true; }, { tries: 3, waitMs: 5 }), undefined);
  assert.equal(ran, false);
  assert.ok(existsSync(join(root, LOCK_REL)));
});

test('R12: a lock left behind by a dead hook is taken over once it is stale', async () => {
  const root = await project();
  await mkdir(join(root, LOCK_REL), { recursive: true });
  const old = new Date(Date.now() - 60_000);
  await utimes(join(root, LOCK_REL), old, old);
  assert.equal(await withLock(root, async () => 'tomado', { tries: 2, waitMs: 5 }), 'tomado');
});

test('R12: parallel hooks do not lose tokens', async () => {
  const root = await project();
  const files = await Promise.all(Array.from({ length: 6 }, async (_, i) => {
    const path = join(root, `s${i}.jsonl`);
    await writeFile(path, msg(`m${i}`, 1, 0));
    return path;
  }));
  await Promise.all(files.map((path) => recordActivity(root, tool({ transcript_path: path }))));
  assert.equal((await usageFile(root)).tasks.T2.input, 6);
  assert.equal((await activity(root)).length, 6);
});
