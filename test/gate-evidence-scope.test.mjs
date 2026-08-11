// T10 (spec 013, R7) — el alcance, en la evidencia.
//
// Todo lo que la spec 013 construye descansa en una decisión invisible: qué archivos se miraron. Si
// esa decisión no queda escrita, el informe deja de ser evidencia y pasa a ser una afirmación —
// "revisado", sin forma de comprobar qué. Y lo que se dejó fuera importa igual que lo que entró: un
// alcance estrecho sin declarar se lee exactamente como "no había nada".
//
// Va en los dos artefactos por la misma razón que el veredicto: el informe lo lee una persona, el
// estado lo lee el advisor, y los dos salen de la misma corrida para que no puedan contradecirse.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEvidence, renderState } from '../catalog/gate/lib/evidence.mjs';

const DATE = new Date(2026, 7, 11, 9, 14);

const scope = (over = {}) => ({
  files: ['src/pago.service.ts'],
  source: 'registry',
  from: 'a1b2c3d4e5',
  excluded: [],
  reverted: [],
  staleRegistry: false,
  ...over
});

const meta = (over = {}) => ({ date: DATE, branch: 'feature/013', role: 'back', spec: 'specs/013-alcance', scope: scope(), ...over });

const stages = [{ stage: 'tests', ok: true, blocked: false, command: 'npm test', code: 0, ms: 100, findings: [] }];

const render = (over = {}, lang = 'es') => renderEvidence({ stages, meta: meta(over), lang });

test('the report says which files were reviewed', async () => {
  assert.match(render(), /src\/pago\.service\.ts/);
});

// De dónde salió el alcance no es un detalle: "lo dijo el registro de lo que escribí" y "es todo lo
// que cambió desde que nació la rama" son dos revisiones distintas con el mismo aspecto.
test('the report says where the scope came from, in both languages', async () => {
  const es = render();
  const en = render({}, 'en');

  assert.match(es, /registro/i);
  assert.match(en, /record|registry/i);
});

test('the report says which reference the scope was measured against', async () => {
  assert.match(render(), /a1b2c3d4e5/);
});

// Lo que se dejó fuera es la mitad que faltaba. Sin esta línea, un alcance de un archivo en un árbol
// con veinte cambios se lee como "solo cambió uno".
test('what the scope left out is declared, never silently dropped', async () => {
  const md = render({ scope: scope({ excluded: ['src/otra-tarea-a-medias.ts'] }) });

  assert.match(md, /src\/otra-tarea-a-medias\.ts/);
});

test('what was written and then undone is declared too', async () => {
  const md = render({ scope: scope({ reverted: ['src/probando.ts'] }) });

  assert.match(md, /src\/probando\.ts/);
});

// Que hubiera un registro y no se usara es justo lo que nadie adivinaría leyendo el informe.
test('a registry that was ignored for being stale is declared', async () => {
  const md = render({ scope: scope({ source: 'baseline', staleRegistry: true }) });
  const en = render({ scope: scope({ source: 'baseline', staleRegistry: true }) }, 'en');

  assert.notEqual(md, render({ scope: scope({ source: 'baseline' }) }), 'el informe cambia cuando el registro se descartó');
  assert.notEqual(md, en, 'y se dice en el idioma del spec');
});

// Con el alcance sin determinar no hay lista que enseñar, pero el informe no puede quedarse mudo:
// es justo el caso en el que hay que explicar por qué no se revisó nada.
test('an undetermined scope is still reported as a scope', async () => {
  const md = render({ scope: scope({ files: [], source: 'none', from: '', undetermined: true }) });

  assert.match(md, /alcance/i);
});

// Un repo equipado con una versión anterior de chalc puede llegar aquí sin alcance en la meta. El
// informe tiene que salir igual: perder el informe entero por una sección nueva sería peor que no
// tener la sección.
test('the report still renders when there is no scope at all', async () => {
  const md = renderEvidence({ stages, meta: { date: DATE, branch: '', role: '', spec: '' }, lang: 'es' });

  assert.match(md, /npm test/);
});

// ── el estado, para el advisor ────────────────────────────────────────────────────────────────

test('the state carries the same scope the report shows', async () => {
  const state = renderState({ stages, meta: meta(), fast: false });

  assert.deepEqual(state.scope.files, ['src/pago.service.ts']);
  assert.equal(state.scope.source, 'registry');
  assert.equal(state.scope.from, 'a1b2c3d4e5');
});

test('the state carries what was left out', async () => {
  const state = renderState({ stages, meta: meta({ scope: scope({ excluded: ['src/ajeno.ts'] }) }), fast: false });

  assert.deepEqual(state.scope.excluded, ['src/ajeno.ts']);
});

test('the state has a scope even when the run had none', async () => {
  const state = renderState({ stages, meta: { date: DATE, branch: '', role: '', spec: '' }, fast: false });

  assert.deepEqual(state.scope.files, []);
});
