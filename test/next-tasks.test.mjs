// T7 (R21) — la lectura de `tasks.md`, ahora en el catálogo del advisor.
//
// Esta lectura la necesitan dos consumidores: el dashboard de la spec 006, que muestra el progreso,
// y el advisor, que decide con ella. Dos implementaciones podrían discrepar sobre qué cuenta como
// checkbox — y entonces el dashboard diría "2/5" mientras el advisor cree que la feature terminó.
// Por eso baja al catálogo (que es lo que se emite dentro del repo del usuario) y `lib/dashboard.mjs`
// la re-exporta: mismo código, un solo sitio donde equivocarse.
//
// El precedente es la spec 007, que hizo lo mismo con los linters de fronteras y de contrato.

import test from 'node:test';
import assert from 'node:assert/strict';
import { tasksProgress, currentTask, cleanTaskText } from '../catalog/next/lib/tasks.mjs';
import * as dashboard from '../lib/dashboard.mjs';

// ── el dashboard y el advisor comparten EXACTAMENTE la misma función ──────────────────────────

test('R21 — el dashboard re-exporta la lectura del catálogo, no una copia', () => {
  assert.equal(dashboard.tasksProgress, tasksProgress);
  assert.equal(dashboard.currentTask, currentTask);
  assert.equal(dashboard.cleanTaskText, cleanTaskText);
});

// ── progreso ──────────────────────────────────────────────────────────────────────────────────

test('tasksProgress cuenta marcadas y totales, con - o *', () => {
  assert.deepEqual(tasksProgress('- [x] T1\n- [ ] T2\n* [X] T3\ntexto suelto'), { done: 2, total: 3 });
});

test('tasksProgress sobre un tasks.md sin checkboxes devuelve 0/0', () => {
  assert.deepEqual(tasksProgress(''), { done: 0, total: 0 });
  assert.deepEqual(tasksProgress('sin tareas'), { done: 0, total: 0 });
});

test('tasksProgress tolera nulo y undefined', () => {
  assert.deepEqual(tasksProgress(null), { done: 0, total: 0 });
  assert.deepEqual(tasksProgress(undefined), { done: 0, total: 0 });
});

// ── tarea en curso ────────────────────────────────────────────────────────────────────────────

test('currentTask devuelve la PRIMERA pendiente, no la última ni todas', () => {
  assert.equal(
    currentTask('- [x] **T1** (R1) — hecho\n- [ ] **T2** (R2) — en esto voy\n- [ ] T3'),
    '**T2** (R2) — en esto voy'
  );
});

test('currentTask con todo marcado devuelve vacío: es la señal de feature terminada', () => {
  assert.equal(currentTask('- [x] T1\n- [x] T2'), '');
  assert.equal(currentTask(''), '');
});

// ── texto legible ─────────────────────────────────────────────────────────────────────────────

test('cleanTaskText quita el ruido de markdown y colapsa espacios', () => {
  assert.equal(
    cleanTaskText('**T1** `[P]` (R1, R2) — Escribir _tests_ de `AccesoModulo`'),
    'T1 (R1, R2) — Escribir tests de AccesoModulo'
  );
});

test('cleanTaskText trunca con elipsis al largo pedido', () => {
  const long = cleanTaskText('T2 — ' + 'palabra '.repeat(30), 40);
  assert.equal(long.length, 40);
  assert.ok(long.endsWith('…'));
});

test('cleanTaskText sobre vacío no inventa texto', () => {
  assert.equal(cleanTaskText(''), '');
});
