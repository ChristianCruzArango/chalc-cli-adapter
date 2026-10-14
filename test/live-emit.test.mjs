// T7 (spec 020, R1, R4, R8) — el proyecto equipado trae el tablero y sabe cuándo usarlo.
//
// Como el portón y el advisor, el tablero se emite dentro de `.chalc/` y corre con Node a secas, sin chalc
// instalado. Las instrucciones del proyecto le dicen al agente qué hacer cuando el usuario pregunta en qué
// paso va, y el hook de actividad queda documentado —nunca instalado— junto a los demás.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { emitLive, LIVE_ENTRY_REL } from '../lib/liveemit.mjs';
import { emitRepoTools } from '../lib/commands/equip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async (rel) => (await readFile(join(ROOT, rel), 'utf8')).replace(/\r\n/g, '\n');

test('R1: the board is emitted inside .chalc with its launcher', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-live-emit-'));
  await emitLive(dir);
  assert.equal(LIVE_ENTRY_REL, '.chalc/live.mjs');
  assert.match(await readFile(join(dir, LIVE_ENTRY_REL), 'utf8'), /import '\.\/live\/live\.mjs';/);
  for (const rel of ['live/live.mjs', 'live/server.mjs', 'live/record.mjs', 'live/lib/activity.mjs', 'live/lib/view.mjs', 'live/lib/page.mjs', 'live/lib/lifecycle.mjs', 'live/lib/usage.mjs', 'live/lib/lock.mjs', 'live/lib/transcript.mjs', 'live/lib/format.mjs', 'live/lib/labels.mjs', 'live/lib/page-script.mjs', 'live/lib/page-style.mjs', 'live/lib/notes.mjs', 'live/lib/sdd.mjs', 'live/lib/dashboard.mjs', 'live/lib/specfiles.mjs']) {
    assert.ok(existsSync(join(dir, '.chalc', rel)), rel);
  }
});

test('R1: equipping a repo emits the board along with the gate, the advisor and the memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-live-equip-'));
  await emitRepoTools(dir, { language: 'es' });
  for (const rel of ['gate.mjs', 'next.mjs', 'memory.mjs', 'live.mjs']) assert.ok(existsSync(join(dir, '.chalc', rel)), rel);
});

test('R1: everything the board imports stays inside .chalc (it runs without chalc installed)', async () => {
  const files = (await readdir(join(ROOT, 'catalog', 'live'), { recursive: true })).filter((f) => f.endsWith('.mjs'));
  for (const file of files) {
    const text = await read(join('catalog', 'live', file));
    for (const [, spec] of text.matchAll(/from '([^']+)'/g)) {
      assert.ok(spec.startsWith('node:') || spec.startsWith('.'), `${file}: ${spec}`);
      assert.ok(!spec.includes('/lib/../') && !/\.\.\/\.\.\/\.\.\//.test(spec), `${file}: ${spec}`);
    }
  }
});

test('R4: the SDD rules tell the agent to answer «where are you» with the board URL, in both languages', async () => {
  for (const [file, pattern] of [
    ['catalog/methods/sdd/rules-lite.md', /en qué paso vas.*node \.chalc\/live\.mjs.*URL/i],
    ['catalog/methods/sdd/rules-full.md', /en qué paso vas.*node \.chalc\/live\.mjs.*URL/i],
    ['catalog/methods/sdd/rules-lite.en.md', /where (are you|you are).*node \.chalc\/live\.mjs.*URL/i],
    ['catalog/methods/sdd/rules-full.en.md', /where (are you|you are).*node \.chalc\/live\.mjs.*URL/i]
  ]) {
    assert.match(await read(file), pattern, file);
  }
});

const blocks = (doc) => [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));

test('R8: the activity hook is documented in both languages, on every event the board reads', async () => {
  for (const file of ['catalog/hooks/gate-hook.md', 'catalog/hooks/gate-hook.en.md']) {
    const block = blocks(await read(file)).find((b) => JSON.stringify(b).includes('live/record.mjs'));
    assert.ok(block, file);
    const command = [{ type: 'command', command: 'node .chalc/live/record.mjs' }];
    assert.deepEqual(block.hooks.PreToolUse, [{ matcher: '*', hooks: command }], file);
    for (const event of ['SubagentStart', 'SubagentStop', 'Stop']) assert.deepEqual(block.hooks[event], [{ hooks: command }], `${file}: ${event}`);
  }
});

test('R8: the activity block is the same in both languages', async () => {
  const [es, en] = await Promise.all(['catalog/hooks/gate-hook.md', 'catalog/hooks/gate-hook.en.md'].map(read));
  const pick = (doc) => JSON.stringify(blocks(doc).find((b) => JSON.stringify(b).includes('live/record.mjs')));
  assert.equal(pick(es), pick(en));
});

// spec 021, R9: las reglas nombran el comando explícito, con su forma en Codex; la pregunta libre es el respaldo.
test('R9 (spec 021): the SDD rules name the chalc-live command, also in its Codex form, in both languages', async () => {
  for (const file of ['catalog/methods/sdd/rules-lite.md', 'catalog/methods/sdd/rules-full.md', 'catalog/methods/sdd/rules-lite.en.md', 'catalog/methods/sdd/rules-full.en.md']) {
    const text = await read(file);
    assert.ok(text.includes('`/chalc-live`') && text.includes('`$chalc-live`'), file);
  }
});
