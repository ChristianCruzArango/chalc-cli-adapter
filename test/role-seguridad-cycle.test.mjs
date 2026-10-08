// spec 014 · T16, T17 (R18, R19, R20) — el rol `seguridad` dentro del ciclo.
//
// Equipar lo declara en gate.json antes del revisor, y el advisor lo pide primero: el revisor
// comprueba que las correcciones de seguridad son reales, así que tiene que entrar después. Un repo
// equipado antes de esta spec no lo declara, y entonces no se le exige: añadir un rol al catálogo no
// puede dejar trabadas las tareas de quien todavía no volvió a equipar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decide } from '../catalog/next/lib/decide.mjs';
import { detectGateConfig } from '../lib/gatedetect.mjs';

const GATE = 4000;
const BRANCH = 'feature/014-seguridad';

const roles = (...ids) => ids.map((id) => ({
  seguridad: { id, order: 5, cadence: 'task', required: true },
  revisor: { id, order: 10, cadence: 'task', required: true },
  endurecedor: { id, order: 20, cadence: 'feature', required: true }
}[id]));

const snapshot = ({ declared = roles('seguridad', 'revisor', 'endurecedor'), entries = [] } = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: 'T2 — pagar', mtime: GATE - 1 },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, scopeHash: 'h', currentScopeHash: 'h', branch: BRANCH, pending: [] },
  review: { entries },
  changed: { files: ['lib/pago.dart'], newestMtime: 3000 },
  flow: { approvals: { task: true, feature: true }, roles: declared },
  git: { isRepo: true, branch: BRANCH },
  problems: []
});

const signed = (role, over = {}) => ({ role, date: GATE + 500, ok: true, findings: 0, ...over });

test('R18: equipping declares the security role in gate.json, before the reviewer', async () => {
  const { flow } = await detectGateConfig(await mkdtemp(join(tmpdir(), 'chalc-sec-roles-')));
  const ids = flow.roles.map((r) => r.id);

  assert.ok(ids.includes('seguridad'));
  assert.ok(ids.indexOf('seguridad') < ids.indexOf('revisor'));
  assert.deepEqual(flow.roles.find((r) => r.id === 'seguridad'), { id: 'seguridad', order: 5, cadence: 'task', required: true, checklist: 'owasp' });
});

test('R19: after a passing gate the security role is called first', () => {
  const result = decide(snapshot());
  assert.deepEqual([result.action, result.facts.role], ['call_role', 'seguridad']);
});

// La entrada del revisor no cubre a seguridad: cada rol se cubre con la suya.
test('R19: the reviewer signing first does not cover the security role', () => {
  const result = decide(snapshot({ entries: [signed('revisor')] }));
  assert.deepEqual([result.action, result.facts.role], ['call_role', 'seguridad']);
});

test('R19: with security clean, the reviewer comes next; with both clean, the task is ticked', () => {
  const next = decide(snapshot({ entries: [signed('seguridad')] }));
  assert.deepEqual([next.action, next.facts.role], ['call_role', 'revisor']);

  assert.equal(decide(snapshot({ entries: [signed('seguridad'), signed('revisor')] })).action, 'tick_task');
});

test('R19: security findings send the task back before the reviewer is called', () => {
  const result = decide(snapshot({ entries: [signed('seguridad', { ok: false, findings: 2 })] }));
  assert.deepEqual([result.action, result.facts.role, result.facts.findings], ['fix_review', 'seguridad', 2]);
});

// Una entrada anterior a la evidencia es de otra versión del código: no cubre nada.
test('R19: a security entry older than the evidence does not count', () => {
  const result = decide(snapshot({ entries: [signed('seguridad', { date: GATE - 2000 }), signed('revisor')] }));
  assert.deepEqual([result.action, result.facts.role], ['call_role', 'seguridad']);
});

test('R20: a repo whose gate.json does not declare the role is not asked for it', () => {
  const old = snapshot({ declared: roles('revisor', 'endurecedor'), entries: [signed('revisor')] });
  assert.equal(decide(old).action, 'tick_task');
});
