// spec 015 · T15 (R21) — la memoria viaja al repo equipado y corre sin chalc.
//
// Como el portón y el advisor, se copia dentro de `.chalc/` y solo usa Node. Y equipar de nuevo
// regenera el CÓDIGO, nunca los DATOS: la memoria, los conceptos que el repo aprendió y el punto de
// la última captura son del proyecto, y perderlos al actualizar chalc borraría lo aprendido.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emitMemory, MEMORY_ENTRY_REL } from '../lib/memoryemit.mjs';
import { emitRepoTools } from '../lib/commands/equip.mjs';
import { commandOf } from '../catalog/next/lib/actions.mjs';

const repo = () => mkdtemp(join(tmpdir(), 'chalc-mem-emit-'));

test('R21: equipping emits the memory, and it runs with plain node', async () => {
  const root = await repo();
  await emitRepoTools(root, { language: 'es' });

  assert.equal(MEMORY_ENTRY_REL, '.chalc/memory.mjs');
  assert.ok(existsSync(join(root, '.chalc', 'memory.mjs')));
  const out = execFileSync(process.execPath, ['.chalc/memory.mjs', 'concepts'], { cwd: root }).toString();
  assert.match(out, /^dinero — /m);
});

test('R21: equipping again regenerates the code but never touches the data of the repo', async () => {
  const root = await repo();
  await emitMemory(root);
  const data = {
    '.chalc/memory/memory.jsonl': '{"key":"dinero:x","id":"0000aaaa","title":"Regla del repo"}\n',
    '.chalc/memory/concepts.json': '{"dinero":{"synonyms":["comision"]}}\n',
    '.chalc/memory/state.json': '{"capturedUntil":"2026-10-07T00:00:00.000Z"}\n'
  };
  for (const [path, text] of Object.entries(data)) await writeFile(join(root, path), text);

  await emitMemory(root);
  for (const [path, text] of Object.entries(data)) assert.equal(await readFile(join(root, path), 'utf8'), text, path);
});

test('R11: tick_task carries the capture command, next to the gate it closes', () => {
  assert.equal(commandOf('tick_task'), 'node .chalc/memory.mjs capture');
  assert.equal(commandOf('tick_task', { gatePath: '../back/.chalc/gate.mjs' }), 'node ../back/.chalc/memory.mjs capture');
});
