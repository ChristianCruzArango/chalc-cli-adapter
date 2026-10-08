// spec 014 · T13 (R12) — lo suprimido se ve en la evidencia.
//
// Un `chalc-allow` no borra el hallazgo: lo mueve a una sección propia con su motivo. Quien revise la
// tarea —el revisor, el usuario— tiene que poder leer de un vistazo qué se dio por aceptable y por
// qué. Una supresión que no aparece en el informe es una etapa apagada por partes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEvidence, renderState } from '../catalog/gate/lib/evidence.mjs';

const meta = { date: new Date('2026-10-07T15:00:00Z'), branch: 'feature/pagos', role: 'back', spec: '014' };

const security = (findings = [], allowed = []) => ({
  stage: 'security', ok: findings.length === 0, blocked: false, reason: '', command: '', code: null, ms: 3, findings, allowed
});

const ALLOWED = [{ file: 'lib/xls.mjs', line: 37, rule: 'weak-hash', reason: 'RC4 de Excel exige MD5 por especificación' }];

test('R12: the evidence lists every suppression with its file, line, rule and reason', async () => {
  for (const [lang, title] of [['es', /Supresiones de seguridad/], ['en', /Security suppressions/]]) {
    const md = renderEvidence({ stages: [security([], ALLOWED)], meta, lang });

    assert.match(md, title, lang);
    assert.match(md, /lib\/xls\.mjs \| 37 \| weak-hash \| RC4 de Excel exige MD5 por especificación/, lang);
  }
});

// Sin supresiones no hay sección: un encabezado vacío se aprende a saltar, y entonces tampoco se lee
// el día que trae algo.
test('R12: with no suppressions there is no suppression section', async () => {
  const md = renderEvidence({ stages: [security()], meta, lang: 'es' });
  assert.doesNotMatch(md, /Supresiones/);
});

test('R12: the findings of the stage still appear with the rest of the findings', async () => {
  const finding = { file: 'src/api.ts', line: 3, rule: 'hardcoded-secret', data: { match: 'apiKey' } };
  const md = renderEvidence({ stages: [security([finding])], meta, lang: 'es' });

  assert.match(md, /src\/api\.ts \| 3 \| hardcoded-secret/);
  assert.match(md, /\| seguridad \|/);
});

// El estado lleva el conteo para que el advisor y el revisor sepan que hay algo que mirar sin
// parsear el informe redactado.
test('R12: the machine state counts the suppressions of the stage', async () => {
  const state = renderState({ stages: [security([], ALLOWED)], meta, fast: false });
  const stage = state.stages.find((s) => s.stage === 'security');

  assert.equal(stage.allowed, 1);
  assert.equal(stage.findings, 0);
});
