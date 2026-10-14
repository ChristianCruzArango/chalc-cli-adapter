// T11 (spec 020, R10) — el estado del portón dice POR QUÉ, no solo cuántos.
//
// En el primer E2E del tablero, «mutación: bloqueada (not-installed)» no decía qué hacer: el comando de
// instalación estaba solo en `.chalc/gate.md`. El estado lleva ahora cada hallazgo con su regla y sus datos,
// redactados porque los pinta una página. Sigue sin una palabra traducida (spec 008, R13: es igual en todos los
// idiomas): el tablero escribe el texto con `messageOf`, como el informe.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderState, MAX_DETAILS, statusOf } from '../catalog/gate/lib/evidence.mjs';
import { frameOf } from '../catalog/gate/lib/i18n.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';

const meta = { date: new Date('2026-10-13T22:32:13Z'), spec: 'specs/001-saludo' };
const missing = { rule: RULES.notInstalled, data: { tool: 'stryker', install: 'npm i -D @stryker-mutator/core' } };
const mutation = (findings) => ({ stage: 'mutation', ok: false, blocked: true, reason: 'not-installed', findings });

test('R10: each stage carries its findings with their rule and data, ready to be written in any language', () => {
  const [stage] = renderState({ stages: [mutation([missing])], meta, fast: false }).stages;
  assert.deepEqual(stage.details, [{ file: '', line: 0, rule: RULES.notInstalled, data: { tool: 'stryker', install: 'npm i -D @stryker-mutator/core' } }]);
});

test('R10: file and line travel as they are; no data is an empty object; no findings is an empty list', () => {
  const finding = { file: 'src/a.ts', line: 7, rule: 'x-rule' };
  const state = renderState({ stages: [mutation([finding]), { stage: 'tests', ok: true }], meta, fast: false });
  assert.deepEqual(state.stages[0].details, [{ file: 'src/a.ts', line: 7, rule: 'x-rule', data: {} }]);
  assert.deepEqual(state.stages[1].details, []);
});

test('R10: the detail is capped, and the count still says how many there were', () => {
  const many = Array.from({ length: MAX_DETAILS + 5 }, (_, i) => ({ file: `f${i}`, line: i + 1, rule: 'r', data: {} }));
  const [stage] = renderState({ stages: [mutation(many)], meta, fast: false }).stages;
  assert.equal(MAX_DETAILS, 20);
  assert.equal(stage.details.length, MAX_DETAILS);
  assert.equal(stage.findings, MAX_DETAILS + 5);
  assert.equal(stage.details.at(-1).file, `f${MAX_DETAILS - 1}`);
});

test('R10: a secret inside a finding never reaches the state; numbers and lists stay as they are', () => {
  const leaky = { rule: RULES.buildFailed, data: { command: 'deploy --token=ghp_abcdefghijklmnopqrstuvwxyz0123456789', code: 1, list: ['a'] } };
  const [stage] = renderState({ stages: [{ stage: 'build', ok: false, findings: [leaky] }], meta, fast: false }).stages;
  assert.doesNotMatch(stage.details[0].data.command, /ghp_abcdefghijklmnopqrstuvwxyz0123456789/);
  assert.match(stage.details[0].data.command, /^deploy --token=/);
  assert.deepEqual([stage.details[0].data.code, stage.details[0].data.list], [1, ['a']]);
});

test('R10: the words of each stage result are exported, the same ones the report writes', () => {
  const es = frameOf('es');
  assert.equal(statusOf({ blocked: true }, es), es.status.blocked);
  assert.equal(statusOf({ skipped: true, reason: 'fast' }, es), es.status.skippedFast);
  assert.equal(statusOf({ ok: true }, frameOf('en')), frameOf('en').status.passed);
});
