// T11 (spec 017, R10, R11) — un hallazgo previo no se cierra en silencio.
//
// Si la pasada anterior de un rol dejó `FINDINGS: n`, la entrada nueva de ese rol dice qué pasó con
// cada uno: `corregido — archivo:línea`, `no corregido — archivo:línea` o `no aplica — motivo`. Igual
// que una regla de la memoria sin confirmar (spec 015, R17), un hallazgo sin respuesta deja la tarea sin
// cerrar y el control vuelve a una persona. Y un `OK` que reconoce un hallazgo sin corregir se
// contradice: el hallazgo sigue abierto.

import test from 'node:test';
import assert from 'node:assert/strict';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';
import { followupProblems } from '../catalog/next/lib/checklist.mjs';

const GATE = Date.parse('2026-10-13T15:00:00Z');
const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }];

// La pasada anterior, ANTES de la última corrida del portón: dejó dos hallazgos que se corrigieron.
const PRIOR = '## 2026-10-13T14:50:00Z · a1b2c3d4e5 · revisor · FINDINGS: 2\n1. src/tarifa.mjs:3 — redondeo a mano\n2. src/viejo.mjs:9 — nombre engañoso';
const NOW = (verdict, body) => `## 2026-10-13T15:10:00Z · a1b2c3d4e5 · revisor · ${verdict}\n${body}`;

const snap = ({ log = '', baseline = 0 } = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: '**T2** (R2) — Calcular tarifas', mtime: GATE - 1 },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, scopeHash: 'h', currentScopeHash: 'h', branch: 'b', pending: [] },
  review: { entries: allReviews(log) },
  changed: { files: ['src/tarifa.mjs'], newestMtime: GATE - 10 },
  flow: { approvals: { task: true, feature: true }, roles: ROLES },
  git: { isRepo: true, branch: 'b' },
  memory: { entries: [] },
  baseline: { date: baseline },
  problems: []
});

const ANSWERED = ['- Hallazgo 1: corregido — src/tarifa.mjs:3', '- Hallazgo 2: no aplica — el archivo se eliminó en esta tarea'].join('\n');

test('R10: an entry that answers every prior finding lets the task move on', () => {
  assert.equal(decide(snap({ log: `${PRIOR}\n${NOW('OK', ANSWERED)}` })).action, 'tick_task');
});

test('R10: the answers are accepted in English too', () => {
  const body = ['- Finding 1: fixed — src/tarifa.mjs:3', '- Finding 2: n/a — the file was removed in this task'].join('\n');
  assert.equal(decide(snap({ log: `${PRIOR}\n${NOW('OK', body)}` })).action, 'tick_task');
});

test('R10: a prior finding without its line stops the cycle and says which one', () => {
  const result = decide(snap({ log: `${PRIOR}\n${NOW('OK', '- Hallazgo 1: corregido — src/tarifa.mjs:3')}` }));
  assert.equal(result.action, 'ask_human');
  assert.ok(result.facts.problems.some((p) => /revisor/.test(p) && /finding 2: not answered/.test(p)), JSON.stringify(result.facts));
});

test('R10: «fixed» and «not fixed» need a file:line, «not applicable» needs a reason', () => {
  for (const line of ['- Hallazgo 1: corregido — revisado', '- Hallazgo 1: no aplica — no']) {
    const result = decide(snap({ log: `${PRIOR}\n${NOW('OK', `${line}\n- Hallazgo 2: corregido — src/viejo.mjs:9`)}` }));
    assert.equal(result.action, 'ask_human', line);
  }
});

test('R11: an OK that admits a finding is not fixed contradicts itself', () => {
  const body = ['- Hallazgo 1: no corregido — src/tarifa.mjs:3', '- Hallazgo 2: corregido — src/viejo.mjs:9'].join('\n');
  const result = decide(snap({ log: `${PRIOR}\n${NOW('OK', body)}` }));
  assert.equal(result.action, 'ask_human');
  assert.ok(result.facts.problems.some((p) => /finding 1: not fixed but the verdict is OK/.test(p)), JSON.stringify(result.facts));
});

test('R11: a finding still open, listed again with FINDINGS, goes back to be fixed', () => {
  const body = ['- Hallazgo 1: no corregido — src/tarifa.mjs:3', '- Hallazgo 2: corregido — src/viejo.mjs:9', '1. src/tarifa.mjs:3 — redondeo a mano'].join('\n');
  assert.equal(decide(snap({ log: `${PRIOR}\n${NOW('FINDINGS: 1', body)}` })).action, 'fix_review');
});

test('R8: the first review of a task has nothing to answer', () => {
  assert.equal(decide(snap({ log: NOW('OK', '') })).action, 'tick_task');
});

// Regresión del E2E: el portón vuelve a sellar la línea base en cada corrida aprobada con un HEAD nuevo,
// ANTES de que pasen los roles. Con un commit entre dos pasadas del revisor, sus hallazgos quedaban
// «antes de la base»; cortar por ella los habría dejado sin exigir.
test('R8: a baseline sealed after the findings does not hide them', () => {
  const baseline = Date.parse('2026-10-13T14:55:00Z');
  assert.equal(decide(snap({ log: `${PRIOR}\n${NOW('OK', '')}`, baseline })).action, 'ask_human');
});

test('R10: followupProblems lists every problem, one per prior finding', () => {
  const prior = [{ n: 1, text: 'a' }, { n: 2, text: 'b' }, { n: 3, text: 'c' }, { n: 4, text: 'd' }];
  const entry = {
    ok: true,
    followups: {
      1: { status: 'fixed', refs: ['a.js:1'] },
      2: { status: 'fixed', refs: [] },
      3: { status: 'na', reason: 'tres palabras exactas' }
    }
  };
  assert.deepEqual(followupProblems(entry, prior), ['finding 2: fixed without file:line', 'finding 4: not answered']);
  assert.deepEqual(followupProblems(entry, []), []);
  assert.deepEqual(followupProblems({ ok: false }, [{ n: 1, text: 'a' }]), ['finding 1: not answered']);
});
