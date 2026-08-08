// T32 (R13) — el ciclo de cierre de tarea en los tres hand-offs.
//
// Todo lo construido hasta aquí es inútil si el asistente no sabe que existe. El hand-off es el
// ÚNICO texto que lee antes de empezar, así que el ciclo va ahí: correr el portón, pegar su salida,
// llamar al revisor, y no avanzar hasta que ambos den verde.
//
// El detalle que decide si funciona: "pega la salida del portón". Sin eso, el asistente puede correr
// el portón y contarte lo que quiera; con eso, la evidencia entra en la conversación tal cual.

import test from 'node:test';
import assert from 'node:assert/strict';
import { closingCycle, closingCycleMulti } from '../lib/gatehandoff.mjs';
import { handoffCommand } from '../lib/commands/specgen.mjs';
import { featureHandoff, featureWorkspaceHandoff } from '../lib/commands/feature.mjs';

const text = (lines) => lines.join('\n');

// ── el ciclo ──────────────────────────────────────────────────────────────────────────────────

test('the closing cycle runs the gate, pastes its output and calls the reviewer', async () => {
  const es = text(closingCycle({ en: false }));

  assert.match(es, /node \.chalc\/gate\.mjs/);
  assert.match(es, /pega/i, 'la salida del portón tiene que entrar en la conversación tal cual');
  assert.match(es, /revisor/i);
});

test('the closing cycle forbids moving on while the gate or the reviewer complain', async () => {
  const es = text(closingCycle({ en: false }));

  assert.match(es, /no avances|no pases/i);
  assert.match(es, /distinto de cero|≠ 0/i);
});

// Una corrida rápida omite la mutación: si el hand-off no lo dijera, `--fast` se convertiría en el
// atajo por defecto y la mutación volvería a no correrse nunca.
test('the closing cycle says a fast run does not close a task', async () => {
  assert.match(text(closingCycle({ en: false })), /--fast/);
  assert.match(text(closingCycle({ en: true })), /--fast/);
});

test('the closing cycle exists in both languages', async () => {
  const es = text(closingCycle({ en: false }));
  const en = text(closingCycle({ en: true }));

  assert.notEqual(es, en);
  assert.match(en, /paste/i);
  assert.match(en, /reviewer/i);
});

test('the closing cycle points at the gate of the repo it is given', async () => {
  const es = text(closingCycle({ en: false, gatePath: 'back/.chalc/gate.mjs' }));

  assert.match(es, /node back\/\.chalc\/gate\.mjs/);
});

// ── varios repos ──────────────────────────────────────────────────────────────────────────────

test('the multi-repo cycle names the gate of every side and forbids switching repos', async () => {
  const es = text(closingCycleMulti({
    en: false,
    repos: [{ label: 'BACKEND', gatePath: 'back/.chalc/gate.mjs' }, { label: 'FRONTEND', gatePath: 'front/.chalc/gate.mjs' }]
  }));

  assert.match(es, /back\/\.chalc\/gate\.mjs/);
  assert.match(es, /front\/\.chalc\/gate\.mjs/);
  assert.match(es, /BACKEND/);
  assert.match(es, /no cambies de repo/i);
});

// ── los tres hand-offs ────────────────────────────────────────────────────────────────────────

test('the mono-repo hand-off carries the closing cycle in both languages', async () => {
  for (const [specLang, gate] of [['español', /node \.chalc\/gate\.mjs/], ['English', /node \.chalc\/gate\.mjs/]]) {
    const out = handoffCommand('specs/007-carrito', [], specLang);

    assert.match(out, gate, `${specLang}: falta el portón en el hand-off`);
    assert.match(out, /revisor|reviewer/i, `${specLang}: falta el revisor`);
  }
});

test('the full-stack hand-off carries the cycle of each repo', async () => {
  const out = featureHandoff({
    backPath: '/repos/api', backRel: 'specs/007-carrito',
    frontPath: '/repos/web', frontRel: 'specs/007-carrito',
    branch: 'feature/007-carrito', backBranchCreated: true, frontBranchCreated: true, specLang: 'español'
  });

  assert.match(out, /\/repos\/api\/\.chalc\/gate\.mjs/);
  assert.match(out, /\/repos\/web\/\.chalc\/gate\.mjs/);
  assert.match(out, /no cambies de repo/i);
});

test('the full-stack hand-off includes the mobile repo when there is one', async () => {
  const out = featureHandoff({
    backPath: '/repos/api', backRel: 'specs/007', frontPath: '/repos/web', frontRel: 'specs/007',
    mobilePath: '/repos/app', mobileRel: 'specs/007',
    branch: 'feature/007', backBranchCreated: true, frontBranchCreated: true, mobileBranchCreated: true, specLang: 'English'
  });

  assert.match(out, /\/repos\/app\/\.chalc\/gate\.mjs/);
  assert.match(out, /reviewer/i);
});

test('the workspace hand-off carries the cycle with the paths inside the workspace', async () => {
  const out = featureWorkspaceHandoff({ id: '007-carrito', branch: 'feature/007-carrito', specLang: 'español', hasMobile: true });

  assert.match(out, /back\/\.chalc\/gate\.mjs/);
  assert.match(out, /front\/\.chalc\/gate\.mjs/);
  assert.match(out, /movil\/\.chalc\/gate\.mjs/);
});
