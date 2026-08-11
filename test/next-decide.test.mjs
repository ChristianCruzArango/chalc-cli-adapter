// T1 (R9, R7) — la tabla de prioridad del advisor: de un snapshot del repo a UNA acción.
//
// Aquí vive todo el valor de la spec 008. El portón ya mide; lo que faltaba era quién decide con esa
// medida, y esa decisión tiene que ser comprobable sin tocar disco: `decide` es pura y recibe hechos
// ya leídos. Si esta tabla se equivoca, el asistente cierra tareas con evidencia rancia — que es
// exactamente el agujero que 007 dejó abierto.
//
// Las fechas son milisegundos de época a propósito: comparar números hace la precedencia evidente y
// mantiene a `decide` fuera del alcance de la hora de ejecución (R7).

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/next/lib/decide.mjs';

// Línea de tiempo del repo sano: el fuente se tocó, el portón corrió después, el revisor después,
// y la tarea se marcó al final. Todo lo demás son variaciones sobre este orden.
const TOUCHED = 3000;
const GATE = 4000;
const REVIEW = 4500;
const TICKED = 5000;

// Los roles del ciclo, como los declara `catalog/agents/` (spec 009).
const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }];

const BRANCH = 'feature/008-advisor';

// Snapshot base: verde ya reclamado y una tarea pendiente por delante → toca trabajar.
const snapshot = (over = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: 'T2 — implementar el lector', mtime: TICKED, ...over.tasks },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, branch: BRANCH, pending: [], ...over.gate },
  review: { entries: [{ role: 'revisor', date: REVIEW, ok: true, findings: 0 }], ...over.review },
  changed: { files: ['src/pago.ts'], newestMtime: TOUCHED, ...over.changed },
  flow: { approvals: { task: true, feature: true }, review: { required: true }, roles: ROLES, ...over.flow },
  git: { isRepo: true, branch: BRANCH, ...over.git }
});

const actionOf = (over) => decide(snapshot(over)).action;

// ── las ocho ramas de la tabla ────────────────────────────────────────────────────────────────

test('R9.1 — configuración incompleta bloquea antes que nada', () => {
  assert.equal(actionOf({ gate: { pending: ['test.command'] } }), 'blocked_config');
});

test('R9.2 — trabajo posterior a la evidencia pide correr el portón', () => {
  assert.equal(actionOf({ changed: { newestMtime: GATE + 1 } }), 'run_gate');
});

test('R9.3 — evidencia vigente que no aprueba pide arreglar lo que reporta', () => {
  assert.equal(actionOf({ gate: { verdict: 'fail' } }), 'fix_gate');
  assert.equal(actionOf({ gate: { verdict: 'blocked' } }), 'fix_gate');
});

test('R9.4 — verde sin revisión posterior pide al revisor', () => {
  assert.equal(actionOf({ review: { entries: [] } }), 'call_role');
  assert.equal(actionOf({ review: { entries: [{ role: 'revisor', date: GATE - 1, ok: true, findings: 0 }] } }), 'call_role');
});

test('R9.5 — revisión posterior con hallazgos pide arreglarlos', () => {
  assert.equal(actionOf({ review: { entries: [{ role: 'revisor', date: REVIEW, ok: false, findings: 3 }] } }), 'fix_review');
});

test('R9.6 — verde revisado y sin reclamar pide marcar la tarea', () => {
  assert.equal(actionOf({ tasks: { mtime: GATE - 1 } }), 'tick_task');
});

test('R9.7 — verde ya reclamado y tarea pendiente: a trabajar', () => {
  assert.equal(decide(snapshot()).action, 'work_task');
});

test('R9.8 — sin tareas pendientes, la feature terminó', () => {
  assert.equal(actionOf({ tasks: { done: 3, total: 3, current: '' } }), 'done');
});

// ── precedencia: el primero que aplique, no el más llamativo ──────────────────────────────────

test('R9 — la configuración incompleta gana a cualquier otro estado', () => {
  assert.equal(
    actionOf({ gate: { pending: ['mutation.command'], verdict: 'fail' }, changed: { newestMtime: GATE + 1 } }),
    'blocked_config'
  );
});

test('R9 — correr el portón gana a arreglarlo: la evidencia vieja no dice nada del código de ahora', () => {
  assert.equal(actionOf({ gate: { verdict: 'fail' }, changed: { newestMtime: GATE + 1 } }), 'run_gate');
});

test('R9 — arreglar el portón gana a llamar al revisor y a sus hallazgos', () => {
  assert.equal(actionOf({ gate: { verdict: 'fail' }, review: { entries: [] } }), 'fix_gate');
  assert.equal(actionOf({ gate: { verdict: 'fail' }, review: { entries: [{ role: 'revisor', date: REVIEW, ok: false, findings: 2 }] } }), 'fix_gate');
});

test('R9 — llamar al revisor gana a marcar la tarea', () => {
  assert.equal(actionOf({ tasks: { mtime: GATE - 1 }, review: { entries: [] } }), 'call_role');
});

test('R9 — arreglar los hallazgos gana a marcar la tarea', () => {
  assert.equal(actionOf({ tasks: { mtime: GATE - 1 }, review: { entries: [{ role: 'revisor', date: REVIEW, ok: false, findings: 1 }] } }), 'fix_review');
});

test('R9 — marcar la tarea gana a trabajar la siguiente', () => {
  // El verde está sin reclamar y además queda trabajo por delante: primero se cierra lo hecho.
  assert.equal(actionOf({ tasks: { mtime: GATE - 1, done: 0, total: 3 } }), 'tick_task');
});

test('R9.6 — sin tarea que marcar, un verde sin reclamar no inventa un tick', () => {
  assert.equal(actionOf({ tasks: { mtime: GATE - 1, done: 3, total: 3, current: '' } }), 'done');
});

test('R9.6 — en el empate exacto, el verde se da por RECLAMADO y no se vuelve a marcar', () => {
  // `tasks.md` con la misma fecha que la evidencia no permite saber cuál fue primero. Las dos
  // salidas no son igual de graves: caer a `work_task` solo cuesta una vuelta más del ciclo, pero
  // volver a marcar daría por hecha la tarea SIGUIENTE sin haberla tocado. Ante el empate, no se
  // marca. (Mutante M10 de la pasada de mutación: `<` → `<=` sobrevivía sin este test.)
  assert.equal(actionOf({ tasks: { mtime: GATE } }), 'work_task');
});

// ── R7: determinismo y ausencia de efectos ────────────────────────────────────────────────────

test('R7 — dos llamadas sobre el mismo estado devuelven lo mismo', () => {
  const state = snapshot({ tasks: { mtime: GATE - 1 } });
  assert.deepEqual(decide(state), decide(state));
});

test('R7 — decide no muta el snapshot que recibe', () => {
  const state = snapshot();
  const copy = structuredClone(state);
  decide(state);
  assert.deepEqual(state, copy);
});

// `decide` decide y aporta los hechos; la redacción del motivo es de `i18n.mjs` y el comando de
// `actions.mjs`. Mezclarlos aquí le daría tres razones de cambio al archivo que concentra el riesgo.
test('R6 — toda decisión trae una acción y los hechos que la sostienen', () => {
  for (const over of [
    { gate: { pending: ['test.command'] } },
    { changed: { newestMtime: GATE + 1 } },
    { gate: { verdict: 'fail' } },
    { review: { entries: [] } },
    { review: { entries: [{ role: 'revisor', date: REVIEW, ok: false, findings: 3 }] } },
    { tasks: { mtime: GATE - 1 } },
    {},
    { tasks: { done: 3, total: 3, current: '' } }
  ]) {
    const result = decide(snapshot(over));
    assert.equal(typeof result.action, 'string', 'la acción es obligatoria');
    assert.ok(result.action.length, 'la acción no puede ir vacía');
    assert.ok(result.facts && typeof result.facts === 'object', 'los hechos son obligatorios');
  }
});
