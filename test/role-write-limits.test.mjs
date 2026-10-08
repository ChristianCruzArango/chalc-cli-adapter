// F-15 — los roles de revisión no pueden prometer más de lo que el asistente hace cumplir, y si un
// rol toca código, la evidencia deja de valer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DICT } from '../lib/i18n.mjs';
import { loadRoles, toolsFor } from '../lib/roles.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';

test('the equip notice does not claim real permissions: it names the convention', () => {
  for (const lang of ['es', 'en']) {
    const text = DICT[lang].rolesEnforced('revisor');
    assert.match(text, /Bash/);
    assert.match(text, /convenci[oó]n|convention/);
  }
});

test('no catalog role is ever granted Edit', async () => {
  for (const role of await loadRoles()) assert.equal(toolsFor(role).some((t) => /Edit/.test(t)), false, role.id);
});

test('if a role changes the reviewed code, the advisor asks for the gate again instead of closing', () => {
  const base = {
    tasks: { hasTasksFile: true, done: 0, total: 2, current: 'T1', mtime: 0 },
    gate: { exists: true, date: 5000, verdict: 'pass', fast: false, branch: 'main', pending: [], scopeHash: 'antes', currentScopeHash: 'antes' },
    review: { entries: [{ role: 'revisor', date: 6000, ok: true, findings: 0, commit: 'abcdef1' }] },
    changed: { files: ['src/a.ts'], newestMtime: 1 },
    flow: { approvals: { task: true, feature: true }, roles: [{ id: 'revisor', order: 10, cadence: 'task', required: true }] },
    git: { isRepo: true, branch: 'main' },
    problems: []
  };
  assert.equal(decide(base).action, 'tick_task');
  assert.equal(decide({ ...base, gate: { ...base.gate, currentScopeHash: 'despues' } }).action, 'run_gate');
});
