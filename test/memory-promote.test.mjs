// Spec 036 (memoria compartida), T2 — de lección a regla de todo el equipo (R5, R6, R7): lo que se repite queda
// como candidata, y promoverla la decide el usuario, desde su terminal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { run } from '../catalog/memory/memory.mjs';
import { readMemory, remember } from '../catalog/memory/lib/store.mjs';
import { MAX_PROMOTED, candidatesOf, lessonsOf } from '../catalog/memory/lib/lessons.mjs';
import { textOf } from '../catalog/memory/lib/text.mjs';

const TTY = { isTTY: true };
const rule = (n, extra = {}) => ({ key: `pagos:regla-${n}`, kind: 'rule', concepts: ['pagos'], title: `Regla ${n}`, files: [], ...extra });
const idOf = async (root, key) => (await readMemory(root)).entries.find((e) => e.key === key).id;
// El proyecto de prueba fija su idioma: lo que dice la memoria no depende del idioma con que corra la suite.
async function store(t, entries = []) {
  const root = await tempDir(t, 'chalc-036-promote-');
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ language: 'en' }));
  for (const [entry, times = 1] of entries) for (let i = 0; i < times; i += 1) await remember(root, entry);
  return root;
}
const tx = textOf('en');

test('R6: candidata es lo que se repitió dos veces o más y no está promovido', async (t) => {
  const root = await store(t, [[rule(1), 2], [rule(2), 1], [rule(3), 3]]);
  const entries = (await readMemory(root)).entries;
  assert.deepEqual(candidatesOf(entries).map((e) => [e.title, e.seen]), [['Regla 3', 3], ['Regla 1', 2]], 'la más repetida primero');
  const out = await run(['candidates'], root);
  assert.equal(out.code, 0);
  assert.ok(out.out.includes('Regla 3') && out.out.includes('Regla 1') && !out.out.includes('Regla 2'));
  assert.equal((await run(['candidates'], await store(t))).out, tx.noCandidates);
});

test('R7: promover exige una terminal interactiva; sin ella no cambia nada', async (t) => {
  const root = await store(t, [[rule(1), 2]]);
  const id = await idOf(root, 'pagos:regla-1');
  const refused = await run(['promote', id], root);
  assert.deepEqual([refused.code, refused.out], [1, tx.needsTerminal]);
  assert.equal((await readMemory(root)).entries[0].promoted, undefined);
  const done = await run(['promote', id], root, new Date(), TTY);
  assert.equal(done.code, 0, done.out);
  const entry = (await readMemory(root)).entries[0];
  assert.deepEqual([entry.promoted, entry.seen], [true, 2], 'promover no cuenta como otra repetición');
  assert.deepEqual(candidatesOf((await readMemory(root)).entries), [], 'ya no es candidata');
});

test('R7: retirar una promovida también es del usuario, y un id que no existe se dice', async (t) => {
  const root = await store(t, [[rule(1), 2]]);
  const id = await idOf(root, 'pagos:regla-1');
  await run(['promote', id], root, new Date(), TTY);
  assert.equal((await run(['demote', id], root)).code, 1);
  assert.equal((await run(['demote', id], root, new Date(), TTY)).code, 0);
  assert.equal((await readMemory(root)).entries[0].promoted, false);
  for (const args of [['promote', 'nadie000'], ['promote'], ['demote', 'nadie000']]) assert.equal((await run(args, root, new Date(), TTY)).code, 1, args.join(' '));
});

test('R7: con el tope de promovidas alcanzado no se promueve otra hasta retirar alguna', async (t) => {
  assert.equal(MAX_PROMOTED, 20);
  const root = await store(t, Array.from({ length: MAX_PROMOTED + 1 }, (_, n) => [rule(n)]));
  for (let n = 0; n < MAX_PROMOTED; n += 1) assert.equal((await run(['promote', await idOf(root, `pagos:regla-${n}`)], root, new Date(), TTY)).code, 0);
  const extra = await idOf(root, `pagos:regla-${MAX_PROMOTED}`);
  const full = await run(['promote', extra], root, new Date(), TTY);
  assert.deepEqual([full.code, full.out], [1, tx.promotedFull(MAX_PROMOTED)]);
  await run(['demote', await idOf(root, 'pagos:regla-0')], root, new Date(), TTY);
  assert.equal((await run(['promote', extra], root, new Date(), TTY)).code, 0);
});

test('R5: las lecciones de una orden: primero las promovidas, luego las del concepto, cinco como mucho', () => {
  const entry = (n, extra) => ({ id: `id${n}`, ...rule(n), seen: n, date: `2026-11-0${n}`, ...extra });
  const entries = [entry(1), entry(2, { concepts: ['envios'] }), entry(3, { promoted: true, concepts: ['envios'] }), entry(4), entry(5), entry(6), entry(7, { promoted: true }), entry(8)];
  assert.deepEqual(lessonsOf(entries, ['pagos']).map((e) => e.title), ['Regla 7', 'Regla 3', 'Regla 8', 'Regla 6', 'Regla 5']);
  assert.deepEqual(lessonsOf(entries, []).map((e) => e.title), ['Regla 7', 'Regla 3'], 'sin concepto en común, solo las promovidas');
  assert.deepEqual(lessonsOf([], ['pagos']), []);
  assert.deepEqual(lessonsOf(entries, ['pagos'], { limit: 1 }).map((e) => e.title), ['Regla 7']);
});

test('el uso nombra los comandos nuevos, en los dos idiomas', () => {
  for (const lang of ['es', 'en']) for (const command of ['candidates', 'promote', 'demote']) assert.ok(textOf(lang).usage.includes(command), `${lang}: ${command}`);
});
