// spec 015 · T12 (R7, R20) — la memoria desde la línea de comandos.
//
// Es lo que usa un modelo fuera del ciclo, o una persona. La búsqueda la hace este script y no la IA:
// por grande que sea el archivo, sale como mucho un puñado de líneas cortas, y el detalle completo
// solo de la entrada que se pida.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../catalog/memory/memory.mjs';
import { remember, MEMORY_REL } from '../catalog/memory/lib/store.mjs';

const repo = () => mkdtemp(join(tmpdir(), 'chalc-mem-cli-'));

async function withMemory() {
  const root = await repo();
  await remember(root, { key: 'dinero:2-decimales', kind: 'bug', concepts: ['dinero'], title: 'Todo valor monetario usa 2 decimales', detail: 'Se redondea antes de mostrar o enviar.', files: ['src/cobro.mjs'] });
  await remember(root, { key: 'fechas:utc', kind: 'rule', concepts: ['fechas'], title: 'Guardar fechas en UTC', files: ['src/fecha.mjs'] });
  return root;
}

test('R20: search finds by concept, even with a synonym the entry never used', async () => {
  const { code, out } = await run(['search', 'calcular', 'tarifas'], await withMemory());
  assert.equal(code, 0);
  assert.match(out, /^[0-9a-f]{8} · bug · Todo valor monetario usa 2 decimales · src\/cobro\.mjs$/m);
  assert.doesNotMatch(out, /UTC/);
});

test('R20: search with nothing matching says so in one line', async () => {
  const { code, out } = await run(['search', 'logo', 'animado'], await withMemory());
  assert.equal(code, 0);
  assert.equal(out.split('\n').length, 1);
});

test('R20: get returns the whole entry, only for the id asked', async () => {
  const root = await withMemory();
  const id = (await run(['search', 'monto'], root)).out.slice(0, 8);
  const { code, out } = await run(['get', id], root);

  assert.equal(code, 0);
  assert.match(out, /Se redondea antes de mostrar o enviar/);
  assert.doesNotMatch(out, /UTC/);
  assert.equal((await run(['get', 'ffffffff'], root)).code, 1);
});

test('R7: concepts lists one line per concept', async () => {
  const { out } = await run(['concepts'], await repo());
  assert.match(out, /^dinero — /m);
  assert.ok(out.split('\n').length >= 9);
});

test('R11: capture runs from the command line and reports what it stored', async () => {
  const { code, out } = await run(['capture'], await repo());
  assert.equal(code, 0);
  assert.match(out, /0/);
});

test('R20: an unknown command prints the usage and fails', async () => {
  const { code, out } = await run(['borrar-todo'], await repo());
  assert.equal(code, 1);
  assert.match(out, /search/);
});

// El tamaño del archivo cuesta milisegundos, no tokens: con 20.000 entradas la salida sigue siendo
// de como mucho 8 líneas.
test('R20: a 20,000-line memory still answers with at most 8 short lines, quickly', async () => {
  const root = await repo();
  const lines = Array.from({ length: 20000 }, (_, i) => JSON.stringify({
    id: i.toString(16).padStart(8, '0'), key: `k${i}`, kind: 'rule', concepts: [i % 2 ? 'dinero' : 'fechas'],
    title: `Regla número ${i} sobre montos y fechas`, files: [`src/f${i}.mjs`], seen: i % 7, date: '2026-10-01T00:00:00Z'
  }));
  await mkdir(join(root, '.chalc', 'memory'), { recursive: true });
  await writeFile(join(root, MEMORY_REL), lines.join('\n') + '\n');

  const started = Date.now();
  const { out } = await run(['search', 'monto'], root);
  const ms = Date.now() - started;

  const found = out.split('\n');
  assert.equal(found.length, 8, 'encuentra, y entrega exactamente el tope');
  assert.ok(found.every((l) => /^[0-9a-f]{8} · rule · /.test(l) && l.length <= 160), out);
  assert.ok(ms < 2000, `tardó ${ms} ms`);
});

// El idioma del proyecto vive en .chalc/gate.json, igual que para el portón.
const speak = async (root, language) => {
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ language }));
  return root;
};

test('R20: each command answers in its own words', async () => {
  const root = await speak(await withMemory(), 'es');
  assert.equal((await run(['search', 'logo'], root)).out, 'Nada en la memoria sobre eso.');
  assert.equal((await run(['compact'], root)).out, 'No hacía falta compactar.');
  assert.match((await run(['capture'], root)).out, /^Memoria: 0 regla\(s\) y 0 decisión\(es\) capturadas\.$/);
  const usage = (await run([], root)).out;
  for (const command of ['search', 'get', 'concepts', 'capture', 'compact']) assert.match(usage, new RegExp(`memory\\.mjs ${command}`));
});

test('R3: compact reports when it did compact', async () => {
  const root = await speak(await withMemory(), 'es');
  for (let i = 0; i < 4; i++) await remember(root, { key: 'dinero:2-decimales', kind: 'bug', concepts: ['dinero'], title: 'x' });
  assert.equal((await run(['compact'], root)).out, 'Memoria compactada.');
});

test('M-05: the memory answers in the project language', async () => {
  const root = await speak(await withMemory(), 'en');
  assert.equal((await run(['search', 'logo'], root)).out, 'Nothing in memory about that.');
  assert.match((await run(['capture'], root)).out, /^Memory: 0 rule\(s\) and 0 decision\(s\) captured\.$/);
  assert.match((await run([], root)).out, /^Usage:/);
});
