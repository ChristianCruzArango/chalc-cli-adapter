// spec 015 · T1, T2 (R1, R2, R3) — el almacén de la memoria.
//
// Una línea JSON por entrada, solo añadiendo: lo escriben procesos distintos y un archivo que se
// reescribe entero pierde entradas cuando dos escriben a la vez. Repetir una clave no duplica: la
// misma lección vista dos veces es UNA lección más fuerte, no dos que compiten en la búsqueda.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { MEMORY_REL, readMemory, remember, compactIfNeeded } from '../catalog/memory/lib/store.mjs';

const repo = () => mkdtemp(join(tmpdir(), 'chalc-mem-'));
const rawLines = async (root) => (await readFile(join(root, MEMORY_REL), 'utf8')).split('\n').filter(Boolean);

const RULE = {
  key: 'dinero:todo-valor-monetario-usa-2-decimales',
  kind: 'rule',
  concepts: ['dinero'],
  title: 'Todo valor monetario usa 2 decimales',
  detail: 'Los montos se redondean a 2 decimales antes de mostrarse o enviarse.',
  files: ['src/cobro.mjs'],
  commit: 'a1b2c3d',
  origin: { spec: '001-cobros', task: 'T3' }
};

test('R1: an entry is appended as one JSON line with an id and a date', async () => {
  const root = await repo();
  const saved = await remember(root, RULE, { now: new Date('2026-10-07T15:00:00Z') });

  const lines = await rawLines(root);
  assert.equal(lines.length, 1);
  const stored = JSON.parse(lines[0]);
  assert.match(stored.id, /^[0-9a-f]{8}$/);
  assert.equal(stored.date, '2026-10-07T15:00:00.000Z');
  // F-23: la línea guarda el INCREMENTO; el total lo suma la lectura (dos procesos no pierden cuentas).
  assert.equal(stored.inc, 1);
  assert.equal(saved.seen, 1);
  assert.equal(stored.learned, '2026-10-07T15:00:00.000Z');
  assert.deepEqual({ ...stored, id: undefined, date: undefined, inc: undefined, learned: undefined }, { ...RULE, id: undefined, date: undefined, inc: undefined, learned: undefined });
  assert.equal(saved.id, stored.id);
});

test('R1: reading an empty or missing memory gives no entries', async () => {
  assert.deepEqual(await readMemory(await repo()), { entries: [], lines: 0 });
});

// El id sale de la clave: la misma lección conserva su id aunque se actualice, y `get <id>` sigue
// encontrándola.
test('R2: the same key updates the entry instead of duplicating it', async () => {
  const root = await repo();
  const first = await remember(root, RULE, { now: new Date('2026-10-07T15:00:00Z') });
  const again = await remember(root, { ...RULE, files: ['src/tarifa.mjs'], commit: 'f0e1d2c' }, { now: new Date('2026-10-08T09:00:00Z') });

  const { entries } = await readMemory(root);
  assert.equal(entries.length, 1);
  assert.equal(again.id, first.id);
  assert.equal(entries[0].seen, 2);
  assert.deepEqual(entries[0].files, ['src/cobro.mjs', 'src/tarifa.mjs']);
  assert.equal(entries[0].commit, 'f0e1d2c');
  assert.equal(entries[0].date, '2026-10-08T09:00:00.000Z');
});

test('R2: different keys are different entries', async () => {
  const root = await repo();
  await remember(root, RULE);
  await remember(root, { ...RULE, key: 'fechas:usar-utc', concepts: ['fechas'], title: 'Guardar fechas en UTC' });

  assert.equal((await readMemory(root)).entries.length, 2);
});

// Una línea rota —un proceso que murió a mitad de escribir— no puede tumbar la memoria entera.
test('R1: a broken line is skipped, not fatal', async () => {
  const root = await repo();
  await remember(root, RULE);
  await writeFile(join(root, MEMORY_REL), (await readFile(join(root, MEMORY_REL), 'utf8')) + '{"key": "roto"\n');

  assert.equal((await readMemory(root)).entries.length, 1);
});

test('R1: an entry without a key is refused', async () => {
  const root = await repo();
  await assert.rejects(() => remember(root, { ...RULE, key: '' }), /clave/);
});

// ── T2 (R3): compactación ─────────────────────────────────────────────────────────────────────

test('R3: compaction keeps only the live version of each key once lines double the entries', async () => {
  const root = await repo();
  for (let i = 0; i < 3; i++) await remember(root, RULE);
  await remember(root, { ...RULE, key: 'fechas:usar-utc', title: 'Guardar fechas en UTC' });

  // Exactamente el doble (4 líneas, 2 entradas) todavía no compacta: el umbral es MÁS del doble.
  assert.equal(await compactIfNeeded(root), false);

  await remember(root, RULE);
  assert.equal((await rawLines(root)).length, 5);
  assert.equal(await compactIfNeeded(root), true);
  assert.equal((await rawLines(root)).length, 2);
  assert.equal((await readMemory(root)).entries.find((e) => e.key === RULE.key).seen, 4);
});

test('R3: below the threshold nothing is rewritten', async () => {
  const root = await repo();
  await remember(root, RULE);
  await remember(root, { ...RULE, key: 'fechas:usar-utc', title: 'Guardar fechas en UTC' });

  assert.equal(await compactIfNeeded(root), false);
  assert.equal((await rawLines(root)).length, 2);
});

test('R3: compacting a missing memory does nothing', async () => {
  assert.equal(await compactIfNeeded(await repo()), false);
});

// Cuándo se aprendió por primera vez: no cambia al volver a verla. Con eso el advisor sabe qué reglas
// existían ya cuando un rol revisó (spec 015, R17).
test('R2: an entry keeps the date it was first learned when it is seen again', async () => {
  const root = await repo();
  await remember(root, RULE, { now: new Date('2026-10-07T15:00:00Z') });
  const again = await remember(root, RULE, { now: new Date('2026-10-09T15:00:00Z') });
  assert.equal(again.learned, '2026-10-07T15:00:00.000Z');
  assert.equal(again.date, '2026-10-09T15:00:00.000Z');
});
