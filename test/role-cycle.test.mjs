// T14–T17 (R7, R8, R9, R15) — el ciclo deja de conocer "el revisor" y pasa a conocer los roles.
//
// Hasta la spec 008 la tabla de prioridad nombraba `call_reviewer`: había uno solo y estaba cableado.
// Con varios roles eso no escala, y peor, deja fuera al que se añada — el endurecedor se emitiría en
// el repo y nadie lo llamaría nunca.
//
// La generalización tiene dos partes delicadas. La **cadencia**: un rol `task` entra al cerrar cada
// tarea y uno `feature` solo al cerrar la última, y confundirlas multiplica el coste en tokens por el
// número de tareas. Y la **cobertura por rol**: una entrada de bitácora cubre al rol que la firma y a
// nadie más, o el advisor daría por revisado lo que nadie revisó.
//
// El vocabulario sigue CERRADO: la acción es `call_role` y el rol viaja en los hechos. Generar
// identificadores dinámicos (`call_endurecedor`) rompería el contrato de máquina que `actions.mjs`
// garantiza.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/next/lib/decide.mjs';

const GATE = 4000;
const BRANCH = 'feature/009-roles';

// Dos roles, como el catálogo real: uno por tarea y otro por feature.
const ROLES = [
  { id: 'revisor', order: 10, cadence: 'task', required: true },
  { id: 'endurecedor', order: 20, cadence: 'feature', required: true }
];

// Base: verde sin reclamar, una tarea pendiente por delante, ninguna revisión todavía.
const snapshot = (over = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: 'T2 — el lector', mtime: GATE - 1, ...over.tasks },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, branch: BRANCH, pending: [], ...over.gate },
  review: { entries: [], ...over.review },
  changed: { files: ['src/pago.ts'], newestMtime: 3000, ...over.changed },
  flow: { approvals: { task: true, feature: true }, roles: ROLES, ...over.flow },
  git: { isRepo: true, branch: BRANCH, ...over.git },
  problems: over.problems || []
});

const at = (id, over = {}) => ({ role: id, date: GATE + 500, ok: true, findings: 0, ...over });

const decideOn = (over) => decide(snapshot(over));
const actionOf = (over) => decideOn(over).action;

// ── R7: una acción por rol pendiente, en orden ────────────────────────────────────────────────

test('R7 — sin ninguna revisión, se llama al rol de MENOR orden', () => {
  const result = decideOn({});

  assert.equal(result.action, 'call_role');
  assert.equal(result.facts.role, 'revisor');
});

test('R7 — cubierto el revisor, la tarea se cierra: el endurecedor es de feature', () => {
  assert.equal(actionOf({ review: { entries: [at('revisor')] } }), 'tick_task');
});

test('R7 — la acción es `call_role`, nunca un identificador por rol', () => {
  // Un vocabulario que crece con cada rol deja de ser un contrato de máquina.
  const result = decideOn({});
  assert.ok(!result.action.includes('revisor'), 'el id del rol va en los hechos, no en la acción');
});

test('R7 — la tabla de prioridad no nombra ningún rol concreto', async () => {
  const { readFile } = await import('node:fs/promises');
  const code = await readFile(new URL('../catalog/next/lib/decide.mjs', import.meta.url), 'utf8');

  for (const id of ['revisor', 'endurecedor']) {
    assert.ok(!code.includes(`'${id}'`), `decide.mjs nombra el rol ${id}`);
  }
});

// ── R8: una entrada cubre al rol que la firma, y a nadie más ──────────────────────────────────

test('R8 — la entrada del endurecedor NO cubre al revisor', () => {
  const result = decideOn({ review: { entries: [at('endurecedor')] } });

  assert.equal(result.action, 'call_role');
  assert.equal(result.facts.role, 'revisor', 'firmar por otro no cubre al que falta');
});

test('R8 — una entrada ANTERIOR a la evidencia no cubre: miró otro código', () => {
  const result = decideOn({ review: { entries: [at('revisor', { date: GATE - 1 })] } });

  assert.equal(result.action, 'call_role');
  assert.equal(result.facts.role, 'revisor');
});

test('R8 — hallazgos de un rol mandan arreglarlos, y dicen de quién son', () => {
  const result = decideOn({ review: { entries: [at('revisor', { ok: false, findings: 3 })] } });

  assert.equal(result.action, 'fix_review');
  assert.equal(result.facts.role, 'revisor');
  assert.equal(result.facts.findings, 3);
});

test('R8 — arreglar hallazgos gana a llamar al siguiente rol', () => {
  const result = decideOn({
    tasks: { done: 2, total: 3, current: 'T3', mtime: GATE - 1 },
    review: { entries: [at('revisor', { ok: false, findings: 1 })] }
  });

  assert.equal(result.action, 'fix_review');
});

// ── R15: la cadencia ──────────────────────────────────────────────────────────────────────────

test('R15 — un rol `feature` NO entra mientras queden tareas', () => {
  // Es lo que evita multiplicar el coste en tokens por el número de tareas de la feature.
  const result = decideOn({ review: { entries: [at('revisor')] } });

  assert.equal(result.action, 'tick_task', 'con tareas pendientes, el endurecedor no toca');
});

test('R15 — con TODAS las tareas marcadas, entra el rol de feature antes de done', () => {
  const result = decideOn({
    tasks: { done: 3, total: 3, current: '', mtime: GATE - 1 },
    review: { entries: [at('revisor')] }
  });

  assert.equal(result.action, 'call_role');
  assert.equal(result.facts.role, 'endurecedor');
});

test('R15 — cubierto el rol de feature, la feature termina', () => {
  const result = decideOn({
    tasks: { done: 3, total: 3, current: '', mtime: GATE - 1 },
    review: { entries: [at('revisor'), at('endurecedor')] }
  });

  assert.equal(result.action, 'done');
});

test('R15 — subir el endurecedor a cadencia `task` lo mete en cada cierre', () => {
  const roles = [ROLES[0], { ...ROLES[1], cadence: 'task' }];
  const result = decideOn({ flow: { approvals: { task: true, feature: true }, roles }, review: { entries: [at('revisor')] } });

  assert.equal(result.action, 'call_role');
  assert.equal(result.facts.role, 'endurecedor');
});

// ── R9: un rol que este CLI no sabe invocar no puede bloquear el ciclo ────────────────────────

test('R9 — un rol no requerido se salta', () => {
  const roles = [{ ...ROLES[0], required: false }, ROLES[1]];
  assert.equal(actionOf({ flow: { approvals: { task: true, feature: true }, roles } }), 'tick_task');
});

test('R9 — sin ningún rol requerido, el ciclo cierra igual', () => {
  const roles = ROLES.map((r) => ({ ...r, required: false }));
  assert.equal(
    actionOf({ tasks: { done: 3, total: 3, current: '', mtime: GATE - 1 }, flow: { approvals: { task: true, feature: true }, roles } }),
    'done'
  );
});

// ── compatibilidad: un repo equipado antes de la 009 ──────────────────────────────────────────

test('R7 — sin roles declarados, el ciclo cierra en vez de bloquearse', () => {
  // La compatibilidad con un `gate.json` anterior a esta spec la resuelve `snapshot.mjs`, que es
  // quien lee la config; aquí solo se comprueba que `decide` no se atasque si le llega vacío.
  const state = snapshot({});
  state.flow.roles = [];

  assert.equal(decide(state).action, 'tick_task');
});

// ── el orden general de la tabla no cambia ────────────────────────────────────────────────────

test('R9 — la configuración incompleta sigue ganando a cualquier rol', () => {
  assert.equal(actionOf({ gate: { pending: ['test.command'] } }), 'blocked_config');
});

test('R9 — medir sigue ganando a revisar: la evidencia vieja no dice nada del código de ahora', () => {
  assert.equal(actionOf({ changed: { files: ['src/x.ts'], newestMtime: GATE + 1 } }), 'run_gate');
});

test('R9 — arreglar el portón gana a llamar a cualquier rol', () => {
  assert.equal(actionOf({ gate: { verdict: 'fail' } }), 'fix_gate');
});

// ── huecos que destapó la pasada de mutación ──────────────────────────────────────────────────

test('R8 — de un rol se mira su ÚLTIMA entrada, no la primera', () => {
  // Un rol firma dos veces: hallazgos, y luego OK cuando ya se arreglaron. Quedarse con la primera
  // dejaría el ciclo pidiendo arreglar para siempre algo que ya está arreglado.
  const entries = [
    at('revisor', { date: GATE + 100, ok: false, findings: 2 }),
    at('revisor', { date: GATE + 900 })
  ];

  assert.equal(decideOn({ review: { entries } }).action, 'tick_task');
});

test('R15 — sin tareas pendientes, un rol de cadencia `task` NO retiene la feature', () => {
  // Su momento era el cierre de cada tarea y ya pasó. Retenerla dejaría la feature colgada esperando
  // a un rol que no tiene sobre qué opinar.
  const result = decideOn({ tasks: { done: 3, total: 3, current: '', mtime: GATE - 1 }, review: { entries: [] } });

  assert.equal(result.action, 'call_role');
  assert.equal(result.facts.role, 'endurecedor', 'toca el de feature, no el de tarea');
});
