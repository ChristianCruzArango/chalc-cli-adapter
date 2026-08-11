// T19 y T20 (R19) — el hand-off deja de recitar un orden y pasa a consultar un estado.
//
// El ciclo de la spec 007 era una lista numerada: corre el portón, pega la salida, llama al revisor,
// marca la tarea. Funcionaba mientras el asistente la recordara, y el único que atraparía el olvido
// era el revisor — al que también invoca él.
//
// Ahora el hand-off dice una sola cosa: consulta `node .chalc/next.mjs` y obedece su `COMMAND`.
// Quien lleva la cuenta del punto en que va la tarea es el disco, no la memoria de nadie.
//
// Lo que este archivo protege es que la instrucción llegue a los TRES hand-offs —mono-repo,
// full-stack y workspace— y que en los multi-repo se diga la ruta del advisor de cada lado.
//
// SUCEDE a `test/gate-handoff.test.mjs` (spec 007, T32), que cubría lo mismo sobre el mecanismo
// anterior: `closingCycle`/`closingCycleMulti` y la lista numerada. Aquel se retiró al desaparecer
// las funciones que probaba; cada una de sus aserciones tiene aquí su equivalente.

import test from 'node:test';
import assert from 'node:assert/strict';
import { advisorCycle, advisorCycleMulti } from '../lib/gatehandoff.mjs';
import { handoffCommand } from '../lib/commands/specgen.mjs';
import { featureHandoff, featureWorkspaceHandoff } from '../lib/commands/feature.mjs';

const text = (lines) => lines.join('\n');

// ── el ciclo, en los dos idiomas ──────────────────────────────────────────────────────────────

for (const en of [false, true]) {
  const label = en ? 'en' : 'es';

  test(`R19 (${label}) — el ciclo manda consultar el advisor`, () => {
    assert.match(text(advisorCycle({ en })), /node \.chalc\/next\.mjs/);
  });

  test(`R19 (${label}) — el ciclo prohíbe decidir el siguiente paso por cuenta propia`, () => {
    const cycle = text(advisorCycle({ en }));
    assert.match(cycle, en ? /do not decide|don't decide/i : /no decidas/i);
  });

  test(`R19 (${label}) — el ciclo se repite hasta done`, () => {
    assert.match(text(advisorCycle({ en })), /\bdone\b/);
  });

  test(`R19 (${label}) — el ciclo nombra los tres campos que hay que obedecer`, () => {
    const cycle = text(advisorCycle({ en }));
    assert.match(cycle, /NEXT_ACTION/);
    assert.match(cycle, /COMMAND/);
  });

  test(`R19 (${label}) — ask_human es lo único que para y pregunta`, () => {
    assert.match(text(advisorCycle({ en })), /ask_human/);
  });
}

// ── multi-repo: la ruta del advisor de CADA lado ──────────────────────────────────────────────

test('R19 — el ciclo multi-repo trae el advisor de cada lado', () => {
  const cycle = text(advisorCycleMulti({
    en: false,
    repos: [
      { label: 'BACKEND', nextPath: '../back/.chalc/next.mjs' },
      { label: 'FRONTEND', nextPath: '../front/.chalc/next.mjs' }
    ]
  }));

  assert.match(cycle, /BACKEND/);
  assert.match(cycle, /\.\.\/back\/\.chalc\/next\.mjs/);
  assert.match(cycle, /FRONTEND/);
  assert.match(cycle, /\.\.\/front\/\.chalc\/next\.mjs/);
});

test('R19 — el ciclo multi-repo prohíbe cambiar de repo antes de cerrar el actual', () => {
  const cycle = text(advisorCycleMulti({
    en: false, repos: [{ label: 'BACKEND', nextPath: '.chalc/next.mjs' }]
  }));

  assert.match(cycle, /no cambies de repo/i);
  assert.match(cycle, /done/);
});

// ── T20: los tres hand-offs lo llevan ─────────────────────────────────────────────────────────

test('R19 — el hand-off mono-repo manda consultar el advisor', () => {
  for (const specLang of ['español', 'English']) {
    const handoff = handoffCommand('specs/008-advisor', [], specLang);
    assert.match(handoff, /node \.chalc\/next\.mjs/, `${specLang}: el hand-off no menciona el advisor`);
  }
});

test('R19 — el hand-off full-stack trae el advisor de los dos lados', () => {
  const handoff = featureHandoff({
    backPath: '/repos/back', backRel: 'specs/008-x', frontPath: '/repos/front', frontRel: 'specs/008-x',
    branch: 'feature/008-x', backBranchCreated: true, frontBranchCreated: true, specLang: 'español'
  });

  assert.match(handoff, /\/repos\/back\/\.chalc\/next\.mjs/);
  assert.match(handoff, /\/repos\/front\/\.chalc\/next\.mjs/);
});

test('R19 — el hand-off full-stack con móvil trae los tres', () => {
  const handoff = featureHandoff({
    backPath: '/repos/back', backRel: 'specs/008-x', frontPath: '/repos/front', frontRel: 'specs/008-x',
    mobilePath: '/repos/movil', mobileRel: 'specs/008-x',
    branch: 'feature/008-x', backBranchCreated: true, frontBranchCreated: true, mobileBranchCreated: true,
    specLang: 'español'
  });

  assert.match(handoff, /\/repos\/movil\/\.chalc\/next\.mjs/);
});

test('R19 — el hand-off de workspace también consulta el advisor, por lado', () => {
  const handoff = featureWorkspaceHandoff({ id: '008-x', branch: 'feature/008-x', specLang: 'español' });

  assert.match(handoff, /back\/\.chalc\/next\.mjs/);
  assert.match(handoff, /front\/\.chalc\/next\.mjs/);
});

test('R19 — el hand-off de workspace con móvil trae los tres advisors', () => {
  const handoff = featureWorkspaceHandoff({ id: '008-x', branch: 'feature/008-x', specLang: 'español', hasMobile: true });

  assert.match(handoff, /back\/\.chalc\/next\.mjs/);
  assert.match(handoff, /front\/\.chalc\/next\.mjs/);
  assert.match(handoff, /movil\/\.chalc\/next\.mjs/);
});
