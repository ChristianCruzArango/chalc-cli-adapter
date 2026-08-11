// T8 (R15, R16) y T9 (R13) — los dos lectores que traducen artefactos a hechos.
//
// El advisor decide sobre dos artefactos que NO escribe él: la bitácora del revisor y el estado que
// deja el portón. Los dos llegan con formato acordado, y los dos pueden llegar rotos — uno lo
// escribe un modelo de lenguaje, el otro puede quedar de una versión anterior de chalc.
//
// La regla es la misma en ambos: lo que no se entiende NO se interpreta. Un encabezado con un
// formato raro no es "una revisión sin hallazgos"; es una revisión que no se puede leer, y eso
// termina en `ask_human` (R11) en vez de en un cierre de tarea que nadie auditó.

import test from 'node:test';
import assert from 'node:assert/strict';
import { lastReview } from '../catalog/next/lib/review.mjs';
import { parseGateState } from '../catalog/next/lib/state.mjs';

const at = (iso) => Date.parse(iso);

// ── T8: la bitácora del revisor ───────────────────────────────────────────────────────────────

test('R15 — lee la ÚLTIMA entrada, no la primera: la bitácora solo crece', () => {
  const md = [
    '# Revisiones',
    '',
    '## 2026-08-09T14:32:11Z · a1b2c3d4e5 · revisor · FINDINGS: 2',
    '1. src/pago.ts — dos interfaces exportadas.',
    '2. src/pago.ts — catch vacío.',
    '',
    '## 2026-08-09T15:04:02Z · f6e5d4c3b2 · revisor · OK',
    'Sin hallazgos.'
  ].join('\n');

  const review = lastReview(md);
  assert.equal(review.exists, true);
  assert.equal(review.date, at('2026-08-09T15:04:02Z'));
  assert.equal(review.commit, 'f6e5d4c3b2');
  assert.equal(review.ok, true);
  assert.equal(review.findings, 0);
});

test('R15 — una entrada con hallazgos aporta cuántos', () => {
  const review = lastReview('## 2026-08-09T14:32:11Z · a1b2c3d4e5 · revisor · FINDINGS: 3');
  assert.equal(review.ok, false);
  assert.equal(review.findings, 3);
});

test('R15 — FINDINGS: 0 es una contradicción y no se interpreta como OK', () => {
  // Si el revisor no encontró nada, el contrato dice `OK`. Aceptar las dos formas abriría la puerta
  // a que un cierre dependa de cómo el modelo decidió redactarlo esta vez.
  assert.equal(lastReview('## 2026-08-09T14:32:11Z · a1b2c3d4e5 · revisor · FINDINGS: 0').exists, false);
});

test('R16 — la fecha sale del encabezado, no del archivo: es lo que se compara con la evidencia', () => {
  assert.equal(
    lastReview('## 2026-01-02T03:04:05Z · a1b2c3d4e5 · revisor · OK').date,
    at('2026-01-02T03:04:05Z')
  );
});

test('R15 — sin bitácora no hay revisión', () => {
  assert.equal(lastReview('').exists, false);
  assert.equal(lastReview(null).exists, false);
});

test('R15 — un encabezado con formato inválido NO se interpreta', () => {
  for (const bad of [
    '## revisado hoy · OK',                                  // sin fecha
    '## 2026-08-09T14:32:11Z · revisor · OK',                 // sin commit
    '## 2026-08-09T14:32:11Z · a1b2c3d4e5 · revisor',         // sin veredicto
    '## 2026-08-09T14:32:11Z · a1b2c3d4e5 · revisor · APROBADO',  // veredicto traducido
    '## no-es-fecha · a1b2c3d4e5 · revisor · OK',
    '### 2026-08-09T14:32:11Z · a1b2c3d4e5 · revisor · OK'             // nivel de encabezado equivocado
  ]) {
    assert.equal(lastReview(bad).exists, false, `no debería interpretarse: ${bad}`);
  }
});

test('R15 — una entrada rota DESPUÉS de una buena invalida la lectura, no rescata la vieja', () => {
  // Rescatar la anterior cerraría la tarea con una revisión que no miró este código.
  const md = '## 2026-08-09T14:00:00Z · a1b2c3d4e5 · revisor · OK\n\n## ayer · x · OK';
  assert.equal(lastReview(md).exists, false);
});

// ── T9: el estado que deja el portón ──────────────────────────────────────────────────────────

test('R13 — lee el estado que el portón dejó', () => {
  const state = parseGateState(JSON.stringify({
    date: '2026-08-09T14:32:11Z', verdict: 'pass', fast: false, closesTask: true,
    branch: 'feature/008-advisor', spec: 'specs/008-advisor', role: 'back', stages: []
  }));

  assert.equal(state.exists, true);
  assert.equal(state.date, at('2026-08-09T14:32:11Z'));
  assert.equal(state.verdict, 'pass');
  assert.equal(state.fast, false);
  assert.equal(state.branch, 'feature/008-advisor');
});

test('R13 — sin archivo no hay evidencia, y eso NO es un aprobado', () => {
  const state = parseGateState('');
  assert.equal(state.exists, false);
  assert.notEqual(state.verdict, 'pass');
});

test('R13 — un archivo corrupto se trata como ausente, no como aprobado', () => {
  for (const bad of ['{', 'no soy json', '[]', 'null', '"texto"']) {
    const state = parseGateState(bad);
    assert.equal(state.exists, false, `no debería interpretarse: ${bad}`);
    assert.notEqual(state.verdict, 'pass');
  }
});

test('R13 — un estado sin fecha usable no vale: la frescura es lo único que se compara', () => {
  const state = parseGateState(JSON.stringify({ verdict: 'pass', branch: 'x' }));
  assert.equal(state.exists, false);
});

test('R13 — un veredicto desconocido no se asume aprobado', () => {
  const state = parseGateState(JSON.stringify({ date: '2026-08-09T14:32:11Z', verdict: 'quizá', branch: 'x' }));
  assert.notEqual(state.verdict, 'pass');
});

test('R14 — el --fast ausente se asume presente: ante la duda, no cierra tarea', () => {
  // Un estado de una versión vieja de chalc no traía `fast`. Asumirlo `false` cerraría tareas con
  // corridas que nunca midieron mutación.
  const state = parseGateState(JSON.stringify({ date: '2026-08-09T14:32:11Z', verdict: 'pass', branch: 'x' }));
  assert.equal(state.fast, true);
});

// ── el rol, añadido por la spec 009 (R8) ──────────────────────────────────────────────────────

test('R8 — la entrada identifica QUÉ rol la escribió', () => {
  const review = lastReview('## 2026-08-09T14:32:11Z · a1b2c3d4e5 · endurecedor · OK');

  assert.equal(review.exists, true);
  assert.equal(review.role, 'endurecedor');
});

test('R8 — una entrada sin rol no se interpreta', () => {
  // Con un solo rol el dato sobraba; con varios, aceptarla daría por cubierto a cualquiera.
  assert.equal(lastReview('## 2026-08-09T14:32:11Z · a1b2c3d4e5 · OK').exists, false);
});

test('R8 — el rol se lee tal cual, sin normalizar: es el id del contrato', () => {
  assert.equal(lastReview('## 2026-08-09T14:32:11Z · a1b2c3d4e5 · revisor · FINDINGS: 2').role, 'revisor');
});
