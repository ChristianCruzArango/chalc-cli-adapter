// T6 (R6) y T5 (R10) — el vocabulario de acciones y los hechos que cada una aporta.
//
// `NEXT_ACTION` es un contrato de máquina: el asistente lo compara, no lo lee. Por eso los
// identificadores viven en UN solo sitio y nunca se traducen — si `--lang` pudiera cambiarlos, el
// contrato se rompería al cambiar de idioma el spec.
//
// Y por eso este archivo prueba dos cosas que ningún test de `decide` puede probar solo: que no hay
// acciones sin entrada en el vocabulario (el advisor imprimiría algo que nadie sabe obedecer) ni
// entradas huérfanas (código muerto que finge cubrir un caso).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, commandOf } from '../catalog/next/lib/actions.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';

const GATE = 4000;
const REVIEW = GATE + 500;
// Los roles del ciclo, como los declara `catalog/agents/` (spec 009).
const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }];

const BRANCH = 'feature/008-advisor';

const snapshot = (over = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: 'T2 — implementar el lector', mtime: GATE - 1, ...over.tasks },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, branch: BRANCH, pending: [], ...over.gate },
  review: { entries: [{ role: 'revisor', date: GATE + 500, ok: true, findings: 0 }], ...over.review },
  changed: { files: ['src/pago.ts'], newestMtime: 3000, ...over.changed },
  flow: {
    approvals: { task: true, feature: true }, review: { required: true }, roles: ROLES,
    ...(over.sides ? { sides: over.sides } : {}), ...over.flow
  },
  git: { isRepo: true, branch: BRANCH, ...over.git },
  flowSides: undefined,
  contract: { differs: false, lines: 0, ...over.contract },
  mail: { unread: 0, from: [], ...over.mail },
  problems: over.problems || []
});

// Un snapshot por cada acción alcanzable. Si alguien añade una fila a la tabla de R9 sin añadirla
// aquí, el test de cobertura de abajo lo delata.
const REACHABLE = {
  blocked_config: { gate: { pending: ['test.command'] } },
  run_gate: { changed: { newestMtime: GATE + 1 } },
  fix_gate: { gate: { verdict: 'fail' } },
  call_role: { review: { entries: [] } },
  fix_review: { review: { entries: [{ role: 'revisor', date: REVIEW, ok: false, findings: 3 }] } },
  tick_task: {},
  work_task: { tasks: { mtime: GATE + 1 } },
  done: { tasks: { done: 3, total: 3, current: '', mtime: GATE + 1 } },
  ask_human: { problems: ['evidencia ilegible'] },
  // Coordinación entre lados (spec 010): solo alcanzables en un workspace con varios lados.
  sync_contract: { sides: { me: 'front', owner: 'back', enabled: true }, contract: { differs: true, lines: 4, minePath: 'a.md', ownerPath: '../back/a.md' } },
  read_mail: { sides: { me: 'front', owner: 'back', enabled: true }, mail: { unread: 2, from: ['back'] } }
};

// ── R6: el vocabulario cubre exactamente lo que decide puede devolver ─────────────────────────

test('R6 — toda acción que decide puede devolver está en el vocabulario', () => {
  for (const [expected, over] of Object.entries(REACHABLE)) {
    const { action } = decide(snapshot(over));
    assert.equal(action, expected, `el snapshot de ${expected} devolvió ${action}`);
    assert.ok(ACTIONS.includes(action), `${action} no está en ACTIONS`);
  }
});

test('R6 — el vocabulario no tiene entradas huérfanas', () => {
  const reachable = new Set(Object.values(REACHABLE).map((over) => decide(snapshot(over)).action));
  for (const action of ACTIONS) {
    assert.ok(reachable.has(action), `${action} está en ACTIONS pero decide nunca lo devuelve`);
  }
});

test('R6 — los identificadores son estables: minúsculas y guion bajo, sin espacios ni acentos', () => {
  for (const action of ACTIONS) assert.match(action, /^[a-z][a-z_]*$/, `${action} no es un identificador de máquina`);
});

// ── R6: el comando, cuando lo hay ─────────────────────────────────────────────────────────────

test('R6 — correr el portón es la única acción con comando literal', () => {
  assert.equal(commandOf('run_gate'), 'node .chalc/gate.mjs');
  for (const action of ACTIONS.filter((a) => a !== 'run_gate')) {
    assert.equal(commandOf(action), '', `${action} no debería traer comando`);
  }
});

test('R6 — el comando respeta la ruta del portón del repo que se está cerrando', () => {
  assert.equal(commandOf('run_gate', { gatePath: '../back/.chalc/gate.mjs' }), 'node ../back/.chalc/gate.mjs');
});

test('R6 — una acción desconocida no inventa un comando', () => {
  assert.equal(commandOf('no_existe'), '');
});

// ── R10: cada acción aporta un dato concreto, no solo su nombre ───────────────────────────────

test('R10 — ninguna acción se queda sin hechos que sostengan el motivo', () => {
  for (const [expected, over] of Object.entries(REACHABLE)) {
    const { facts } = decide(snapshot(over));
    const values = Object.values(facts).filter((v) => v !== '' && v !== null && v !== undefined);
    assert.ok(values.length, `${expected} no aporta ningún dato concreto`);
  }
});

test('R10 — los hechos citan el artefacto que produjo la acción', () => {
  assert.deepEqual(decide(snapshot(REACHABLE.blocked_config)).facts.pending, ['test.command']);
  assert.equal(decide(snapshot(REACHABLE.fix_gate)).facts.verdict, 'fail');
  assert.equal(decide(snapshot(REACHABLE.fix_review)).facts.findings, 3);
  assert.equal(decide(snapshot(REACHABLE.tick_task)).facts.task, 'T2 — implementar el lector');
  assert.equal(decide(snapshot(REACHABLE.work_task)).facts.task, 'T2 — implementar el lector');
  assert.equal(decide(snapshot(REACHABLE.done)).facts.total, 3);
});
