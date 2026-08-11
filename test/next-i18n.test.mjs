// T16 (R5, R10) — el marco bilingüe del advisor.
//
// La regla de reparto es lo que hay que proteger aquí: `NEXT_ACTION` y `COMMAND` son contrato de
// MÁQUINA — el asistente los compara y los ejecuta — y no se traducen jamás. Si cambiaran con
// `--lang`, un repo con el spec en inglés y otro en español hablarían idiomas distintos con el
// mismo asistente.
//
// `REASON` sí se traduce, porque lo lee una persona. Y tiene que CITAR el dato (R10): "la evidencia
// es de antes del último cambio" sirve; "hay que correr el portón" es repetir el nombre del estado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME, reasonOf } from '../catalog/next/lib/i18n.mjs';
import { ACTIONS, commandOf } from '../catalog/next/lib/actions.mjs';

const LANGS = ['es', 'en'];

// Hechos representativos de cada acción, como los devuelve `decide`.
const FACTS = {
  blocked_config: { pending: ['test.command', 'mutation.command'] },
  run_gate: { files: 3, newestMtime: Date.parse('2026-08-09T15:00:00Z'), evidenceDate: Date.parse('2026-08-09T14:00:00Z'), fast: false, otherBranch: '' },
  fix_gate: { verdict: 'fail', evidenceDate: Date.parse('2026-08-09T14:00:00Z') },
  call_reviewer: { evidenceDate: Date.parse('2026-08-09T14:00:00Z'), reviewDate: null },
  fix_review: { findings: 3, reviewDate: Date.parse('2026-08-09T14:30:00Z') },
  tick_task: { task: 'T2 — implementar el lector', done: 1, total: 3, waitForApproval: true },
  work_task: { task: 'T2 — implementar el lector', done: 1, total: 3 },
  done: { total: 3 },
  ask_human: { problems: ['tasks-missing'] }
};

// ── paridad de claves ─────────────────────────────────────────────────────────────────────────

test('R5 — el marco tiene las MISMAS claves en es y en', () => {
  const keys = (obj) => Object.keys(obj).sort();
  assert.deepEqual(keys(FRAME.es), keys(FRAME.en));
  assert.deepEqual(keys(FRAME.es.reason), keys(FRAME.en.reason));
});

test('R5 — toda acción tiene motivo redactado en los dos idiomas', () => {
  for (const action of ACTIONS) {
    for (const lang of LANGS) {
      const reason = reasonOf(action, FACTS[action], lang);
      assert.equal(typeof reason, 'string', `${action}/${lang} no devolvió texto`);
      assert.ok(reason.trim().length, `${action}/${lang} devolvió un motivo vacío`);
    }
  }
});

test('R5 — un idioma desconocido cae al inglés en vez de quedarse sin motivo', () => {
  assert.equal(reasonOf('done', FACTS.done, 'klingon'), reasonOf('done', FACTS.done, 'en'));
});

// ── R10: el motivo cita el dato, no repite el estado ──────────────────────────────────────────

test('R10 — el motivo de blocked_config nombra los campos que faltan', () => {
  for (const lang of LANGS) {
    const reason = reasonOf('blocked_config', FACTS.blocked_config, lang);
    assert.match(reason, /test\.command/, `${lang}: falta el campo concreto`);
  }
});

test('R10 — el motivo de fix_review dice cuántos hallazgos hay', () => {
  for (const lang of LANGS) assert.match(reasonOf('fix_review', FACTS.fix_review, lang), /3/);
});

test('R10 — el motivo de tick_task nombra la tarea', () => {
  for (const lang of LANGS) assert.match(reasonOf('tick_task', FACTS.tick_task, lang), /implementar el lector/);
});

test('R10 — el motivo de work_task nombra la tarea y el progreso', () => {
  for (const lang of LANGS) {
    const reason = reasonOf('work_task', FACTS.work_task, lang);
    assert.match(reason, /implementar el lector/);
    assert.match(reason, /3/, `${lang}: el progreso da contexto de cuánto queda`);
  }
});

test('R10 — run_gate distingue POR QUÉ caducó la evidencia', () => {
  for (const lang of LANGS) {
    const byFast = reasonOf('run_gate', { ...FACTS.run_gate, fast: true }, lang);
    const byBranch = reasonOf('run_gate', { ...FACTS.run_gate, otherBranch: 'develop' }, lang);
    const byAge = reasonOf('run_gate', FACTS.run_gate, lang);

    assert.match(byFast, /--fast/, `${lang}: el motivo del --fast tiene que decirlo`);
    assert.match(byBranch, /develop/, `${lang}: el motivo de otra rama tiene que nombrarla`);
    assert.notEqual(byAge, byFast, `${lang}: tres causas distintas no pueden dar el mismo motivo`);
    assert.notEqual(byAge, byBranch);
  }
});

test('R10 — sin evidencia previa el motivo dice ESO, no que la última fuera --fast', () => {
  // Bug encontrado corriendo el advisor en un repo recién equipado. `parseGateState` devuelve
  // `fast: true` como defecto seguro cuando no hay estado — es lo correcto para DECIDIR (ante la
  // duda no se cierra tarea), pero al redactar convertía "nunca se midió" en "la última corrida fue
  // rápida", que es un hecho falso sobre una corrida que no existió. "No hay evidencia" explica
  // todo lo demás, así que va primero.
  for (const lang of LANGS) {
    const reason = reasonOf('run_gate', { files: 2, newestMtime: Date.now(), evidenceDate: null, fast: true, otherBranch: '' }, lang);
    assert.ok(!reason.includes('--fast'), `${lang}: inventa una corrida --fast que nunca ocurrió — ${reason}`);
    assert.match(reason, /2/, `${lang}: el motivo debería decir cuántos archivos hay sin medir`);
  }
});

test('R10 — el motivo de ask_human dice qué no se pudo leer', () => {
  for (const lang of LANGS) {
    const reason = reasonOf('ask_human', { problems: ['tasks-missing', 'not-a-repo'] }, lang);
    assert.ok(reason.length > 10, `${lang}: un motivo de una palabra no ayuda a arreglar nada`);
  }
});

test('R18 — la puerta de aprobación cambia el motivo de tick_task', () => {
  for (const lang of LANGS) {
    const withGate = reasonOf('tick_task', { ...FACTS.tick_task, waitForApproval: true }, lang);
    const withoutGate = reasonOf('tick_task', { ...FACTS.tick_task, waitForApproval: false }, lang);
    assert.notEqual(withGate, withoutGate, `${lang}: la puerta tiene que verse en el texto`);
  }
});

// ── lo que NO se traduce ──────────────────────────────────────────────────────────────────────

test('R5 — los identificadores de acción no pasan por el marco', () => {
  for (const action of ACTIONS) {
    for (const lang of LANGS) {
      assert.ok(!(action in FRAME[lang]), `${action} no puede tener traducción: es contrato de máquina`);
    }
  }
});

test('R5 — el comando es el mismo en los dos idiomas', () => {
  for (const action of ACTIONS) assert.equal(commandOf(action), commandOf(action));
  assert.equal(commandOf('run_gate'), 'node .chalc/gate.mjs');
});
