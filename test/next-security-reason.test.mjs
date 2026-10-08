// spec 014 · T18 (R22) — corregir un hallazgo de seguridad empieza por un test que lo demuestre.
//
// El advisor le dice al modelo qué hacer, y para un hallazgo de seguridad «arregla lo que dice el
// informe» se queda corto: sin un test que reproduzca el ataque, la corrección no se puede comprobar
// y la vulnerabilidad vuelve con el siguiente cambio. Para decirlo, el advisor necesita saber QUÉ
// etapa falló, no solo el veredicto.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGateState } from '../catalog/next/lib/state.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';
import { reasonOf } from '../catalog/next/lib/i18n.mjs';

const state = (stages) => JSON.stringify({ date: '2026-10-07T15:00:00Z', verdict: 'fail', fast: false, stages });

test('R22: the gate state tells which stages failed, skipping the ones that did not run', () => {
  const parsed = parseGateState(state([
    { stage: 'tests', ok: true }, { stage: 'mutation', ok: true, skipped: true },
    { stage: 'smells', ok: false }, { stage: 'security', ok: false }, { stage: 'contract', ok: false, skipped: true }
  ]));
  assert.deepEqual(parsed.failedStages, ['smells', 'security']);
});

test('R22: a state from an older chalc, with no stages, reads as no failed stages', () => {
  assert.deepEqual(parseGateState(JSON.stringify({ date: '2026-10-07T15:00:00Z', verdict: 'fail' })).failedStages, []);
});

test('R22: fix_gate carries the failed stages as facts', () => {
  const result = decide({
    tasks: { hasTasksFile: true, done: 0, total: 2, current: 'T1', mtime: 1 },
    gate: { exists: true, date: 4000, verdict: 'fail', fast: false, scopeHash: 'h', currentScopeHash: 'h', branch: 'b', pending: [], failedStages: ['security'] },
    review: { entries: [] },
    changed: { files: ['lib/a.dart'], newestMtime: 3000 },
    flow: { approvals: { task: true, feature: true }, roles: [] },
    git: { isRepo: true, branch: 'b' },
    problems: []
  });
  assert.equal(result.action, 'fix_gate');
  assert.deepEqual(result.facts.failed, ['security']);
});

const TEST_FIRST = { es: /test que demuestre la vulnerabilidad/, en: /test that demonstrates the vulnerability/ };

test('R22: when the security stage failed, the reason asks for a test that demonstrates it first', () => {
  for (const [lang, pattern] of Object.entries(TEST_FIRST)) {
    const reason = reasonOf('fix_gate', { verdict: 'fail', evidenceDate: 4000, failed: ['smells', 'security'] }, lang);
    assert.match(reason, pattern, lang);
  }
});

test('R22: findings from the security role get the same instruction', () => {
  for (const [lang, pattern] of Object.entries(TEST_FIRST)) {
    assert.match(reasonOf('fix_review', { role: 'seguridad', findings: 1, reviewDate: 4500 }, lang), pattern, lang);
  }
});

// Para el resto no aplica: pedir un «test de la vulnerabilidad» por una función larga confunde.
test('R22: other failures keep their usual reason', () => {
  for (const [lang, pattern] of Object.entries(TEST_FIRST)) {
    assert.doesNotMatch(reasonOf('fix_gate', { verdict: 'fail', evidenceDate: 4000, failed: ['smells'] }, lang), pattern);
    assert.doesNotMatch(reasonOf('fix_review', { role: 'revisor', findings: 1, reviewDate: 4500 }, lang), pattern);
  }
});
