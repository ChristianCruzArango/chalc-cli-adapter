// T4–T7 (R1–R5, R11, R16) — la deriva de contrato dentro del ciclo.
//
// El orden es lo que decide si esto sirve: `sync_contract` va ANTES de `run_gate` porque medir contra
// un contrato viejo gasta una corrida entera —minutos, con mutación— para producir una evidencia que
// hay que tirar.
//
// Y va con el freno puesto en dos sitios. El dueño del contrato nunca recibe la acción: no puede
// hacer nada con ella, quien adapta código es el consumidor. Y un repo sin lados —el mono-repo, que
// es el caso más común— no la ve jamás, porque el advisor tiene prohibido bloquearse por una función
// que no le aplica.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/next/lib/decide.mjs';

const GATE = 4000;
const BRANCH = 'feature/010-buzon';

const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }];

// Un lado consumidor con su contrato al día y trabajo sin medir por delante.
const snapshot = (over = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: 'T2 — el lector', mtime: GATE - 1, ...over.tasks },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, branch: BRANCH, pending: [], ...over.gate },
  review: { entries: [{ role: 'revisor', date: GATE + 500, ok: true, findings: 0 }], ...over.review },
  changed: { files: ['src/pago.ts'], newestMtime: 3000, ...over.changed },
  flow: {
    approvals: { task: true, feature: true }, roles: ROLES,
    sides: { me: 'front', owner: 'back', enabled: true, ...over.sides },
    ...over.flow
  },
  contract: { differs: false, lines: 0, ownerId: 'back', minePath: 'specs/003-pago/contracts/api.md', ownerPath: '../back/specs/003-pago/contracts/api.md', ...over.contract },
  mail: { unread: 0, from: [], ...over.mail },
  git: { isRepo: true, branch: BRANCH, ...over.git },
  problems: over.problems || []
});

const decideOn = (over) => decide(snapshot(over));
const actionOf = (over) => decideOn(over).action;

// ── R1: la deriva se detecta y se dice ────────────────────────────────────────────────────────

test('R1 — con el contrato al día, el ciclo sigue normal', () => {
  assert.equal(actionOf({}), 'tick_task');
});

test('R1 — un contrato derivado para el ciclo', () => {
  const result = decideOn({ contract: { differs: true, lines: 12 } });

  assert.equal(result.action, 'sync_contract');
  assert.equal(result.facts.owner, 'back');
  assert.equal(result.facts.lines, 12);
});

// ── R4: antes de medir ────────────────────────────────────────────────────────────────────────

test('R4 — la deriva gana a correr el portón: medir contra un contrato viejo es tirar la corrida', () => {
  assert.equal(
    actionOf({ contract: { differs: true, lines: 3 }, changed: { files: ['src/x.ts'], newestMtime: GATE + 1 } }),
    'sync_contract'
  );
});

test('R4 — la deriva gana a arreglar el portón y a los roles', () => {
  assert.equal(actionOf({ contract: { differs: true, lines: 3 }, gate: { verdict: 'fail' } }), 'sync_contract');
  assert.equal(actionOf({ contract: { differs: true, lines: 3 }, review: { entries: [] } }), 'sync_contract');
});

test('R4 — la configuración incompleta sigue ganando a la deriva', () => {
  // Sin `gate.json` completo no hay ciclo que ordenar, ni siquiera para el contrato.
  assert.equal(actionOf({ contract: { differs: true, lines: 3 }, gate: { pending: ['test.command'] } }), 'blocked_config');
});

// ── R3: el dueño no ────────────────────────────────────────────────────────────────────────────

test('R3 — el dueño del contrato NO recibe la acción de deriva', () => {
  // No puede hacer nada con ella: quien adapta código es el consumidor, y ese lo detecta solo.
  assert.equal(
    actionOf({ contract: { differs: true, lines: 9 }, sides: { me: 'back', owner: 'back', enabled: true } }),
    'tick_task'
  );
});

test('R2 — el dueño sale de la config, no del nombre `back`', () => {
  const asOwner = actionOf({ contract: { differs: true, lines: 9 }, sides: { me: 'api', owner: 'api', enabled: true } });
  const asConsumer = actionOf({ contract: { differs: true, lines: 9 }, sides: { me: 'web', owner: 'api', enabled: true } });

  assert.equal(asOwner, 'tick_task', 'un dueño llamado `api` sigue siendo el dueño');
  assert.equal(asConsumer, 'sync_contract');
});

// ── R11: apagado, no estorba ──────────────────────────────────────────────────────────────────

test('R11 — sin lados declarados, la deriva no existe', () => {
  const state = snapshot({ contract: { differs: true, lines: 9 } });
  delete state.flow.sides;

  assert.equal(decide(state).action, 'tick_task');
});

test('R13 — con los lados desactivados, tampoco', () => {
  assert.equal(
    actionOf({ contract: { differs: true, lines: 9 }, sides: { me: 'front', owner: 'back', enabled: false } }),
    'tick_task'
  );
});

// ── R8: el buzón, después de la deriva ────────────────────────────────────────────────────────

test('R8 — avisos sin leer se emiten, diciendo cuántos y de quién', () => {
  const result = decideOn({ mail: { unread: 2, from: ['back'] } });

  assert.equal(result.action, 'read_mail');
  assert.equal(result.facts.unread, 2);
  assert.deepEqual(result.facts.from, ['back']);
});

test('R4 — la deriva de contrato gana al buzón: el contrato es lo que rompe la integración', () => {
  assert.equal(actionOf({ contract: { differs: true, lines: 1 }, mail: { unread: 3, from: ['back'] } }), 'sync_contract');
});

test('R8 — el buzón gana a medir: puede que el aviso diga justamente que no midas', () => {
  assert.equal(
    actionOf({ mail: { unread: 1, from: ['back'] }, changed: { files: ['src/x.ts'], newestMtime: GATE + 1 } }),
    'read_mail'
  );
});

test('R11 — sin lados, los avisos sin leer tampoco se emiten', () => {
  const state = snapshot({ mail: { unread: 5, from: ['back'] } });
  delete state.flow.sides;

  assert.equal(decide(state).action, 'tick_task');
});

// ── R16: el comando muestra, no sobrescribe ───────────────────────────────────────────────────

test('R16 — los hechos traen las dos rutas, para poder mostrar la diferencia', () => {
  const result = decideOn({ contract: { differs: true, lines: 4 } });

  assert.equal(result.facts.minePath, 'specs/003-pago/contracts/api.md');
  assert.equal(result.facts.ownerPath, '../back/specs/003-pago/contracts/api.md');
});

// ── T6 (R16) — el comando MUESTRA, nunca sobrescribe ──────────────────────────────────────────

test('R16 — el comando de la deriva es un diff, no una copia', async () => {
  // El requisito existe para que no se pierda nada sin que nadie lo vea: si el consumidor había
  // anotado algo en su copia, un `cp` se lo lleva en silencio. Y quien tiene que adaptar código
  // necesita saber QUÉ cambió, no solo quedarse con el archivo nuevo.
  const { commandOf } = await import('../catalog/next/lib/actions.mjs');
  const { facts } = decideOn({ contract: { differs: true, lines: 4 } });
  const command = commandOf('sync_contract', { facts });

  assert.match(command, /^diff /, `debería mostrar la diferencia: ${command}`);
  for (const destructivo of ['cp ', 'mv ', 'copy ', '>', 'rm ']) {
    assert.ok(!command.includes(destructivo), `el comando no puede contener "${destructivo}": ${command}`);
  }
});

test('R16 — el diff nombra las dos copias, la mía primero', async () => {
  const { commandOf } = await import('../catalog/next/lib/actions.mjs');
  const { facts } = decideOn({ contract: { differs: true, lines: 4 } });

  assert.equal(commandOf('sync_contract', { facts }), 'diff specs/003-pago/contracts/api.md ../back/specs/003-pago/contracts/api.md');
});

test('R16 — sin rutas no se inventa un comando', async () => {
  const { commandOf } = await import('../catalog/next/lib/actions.mjs');
  assert.equal(commandOf('sync_contract', { facts: {} }), '');
});
