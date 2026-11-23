// Spec 034 (roles y lanzadores), T6 — el advisor dentro del worktree de una spec (R12): el desarrollador no
// llama a sus propios revisores ni pide el cierre; con todo hecho y medido, entrega.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/next/lib/decide.mjs';
import { ACTIONS, commandOf } from '../catalog/next/lib/actions.mjs';
import { reasonOf } from '../catalog/next/lib/i18n.mjs';
import { inTeam } from '../catalog/next/lib/teamstage.mjs';
import { READY_SPECS } from './helpers/readyspecs.mjs';

const ROLES = [{ id: 'seguridad', order: 5, cadence: 'task', required: true }, { id: 'revisor', order: 10, cadence: 'task', required: true }, { id: 'endurecedor', order: 20, cadence: 'feature', required: true }];
// Todas las tareas hechas y el portón aprobado; nadie ha revisado nada.
const snapshot = (branch, over = {}) => ({
  specs: READY_SPECS, tdd: { red: true },
  tasks: { hasTasksFile: true, done: 2, total: 2, current: null, mtime: 0 },
  gate: { exists: true, date: 5000, verdict: 'pass', fast: false, branch, pending: [], scopeHash: 'x', currentScopeHash: 'x' },
  review: { entries: [] }, changed: { files: [], newestMtime: 1 },
  flow: { roles: ROLES }, git: { isRepo: true, branch }, problems: [], ...over
});

test('R12: se está en el worktree de una spec cuando la rama es chalc/<carpeta activa>', () => {
  assert.equal(inTeam(snapshot('chalc/001-demo')), true);
  for (const branch of ['main', 'chalc/002-otra', 'chalc/001-demo-v2', 'feature/chalc/001-demo', '']) assert.equal(inTeam(snapshot(branch)), false, branch);
  assert.equal(inTeam({ ...snapshot('chalc/001-demo'), specs: { ...READY_SPECS, dir: null } }), false);
  assert.equal(inTeam({ specs: READY_SPECS }), false, 'sin git no hay worktree');
});

test('R12: en el worktree, con todo hecho y medido, la acción es entregar, con su comando', () => {
  const out = decide(snapshot('chalc/001-demo'));
  assert.deepEqual(out, { action: 'deliver_spec', facts: { dir: 'specs/001-demo', total: 2 } });
  assert.ok(ACTIONS.includes('deliver_spec'));
  assert.equal(commandOf('deliver_spec', { facts: out.facts }), 'node .chalc/team.mjs deliver --spec specs/001-demo');
  for (const lang of ['es', 'en']) assert.ok(reasonOf('deliver_spec', out.facts, lang).includes('specs/001-demo'), lang);
});

test('R12: fuera del worktree nada cambia: con todo hecho se pide el rol de cierre de la feature', () => {
  const out = decide(snapshot('main'));
  assert.deepEqual([out.action, out.facts.role], ['call_role', 'endurecedor']);
});

test('R12: en el worktree tampoco se piden roles al cerrar cada tarea', () => {
  const working = snapshot('chalc/001-demo', { tasks: { hasTasksFile: true, done: 0, total: 2, current: 'T1 (R1)', mtime: 0 }, changed: { files: ['src/a.ts'], newestMtime: 1 } });
  assert.equal(decide(working).action, 'tick_task');
  assert.equal(decide({ ...working, git: { isRepo: true, branch: 'main' }, gate: { ...working.gate, branch: 'main' } }).action, 'call_role');
});

test('R12: sin evidencia del portón todavía no se entrega', () => {
  const out = decide(snapshot('chalc/001-demo', { gate: { exists: false, pending: [] } }));
  assert.notEqual(out.action, 'deliver_spec');
});
