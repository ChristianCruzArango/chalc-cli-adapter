// T2–T6 (R4) — las cuatro reglas con las que la tabla expresa su variación.
//
// El punto delicado de la spec 011. Hoy hay decisiones que son código: el runner de JS sale del
// framework detectado, el comando de Dart de si el `pubspec` nombra Flutter. Pasarlas a datos tiene
// una trampa evidente — inventar un mini-lenguaje de condicionales en JSON, que es código sin tipos,
// sin depurador y sin estos tests.
//
// La salida es un juego CERRADO de cuatro reglas genéricas: ninguna sabe de ningún stack, y cada
// stack dice cuál usa. Añadir una quinta será una decisión consciente con su test, no el efecto
// colateral de añadir un lenguaje.
//
// `resolve` es pura: recibe los hechos ya leídos. Quien toca disco es `tooltable.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../lib/toolrules.mjs';

// Los hechos de un repo, ya leídos.
const input = (over = {}) => ({
  json: {}, signals: {}, deps: {}, entries: [], ...over
});

// ── T2: fixed ─────────────────────────────────────────────────────────────────────────────────

test('R4 — fixed devuelve su valor tal cual, sea cadena u objeto', () => {
  assert.equal(resolve({ rule: 'fixed', value: 'mvn test' }, input()), 'mvn test');
  assert.deepEqual(
    resolve({ rule: 'fixed', value: { tool: 'pit', format: 'pit' } }, input()),
    { tool: 'pit', format: 'pit' }
  );
});

test('R4 — fixed no depende de nada del repo', () => {
  const rule = { rule: 'fixed', value: 'cargo test' };
  assert.equal(resolve(rule, input()), resolve(rule, input({ deps: { serde: '1' }, entries: ['src'] })));
});

// ── T3: jsonField ─────────────────────────────────────────────────────────────────────────────

const npmTest = {
  rule: 'jsonField', file: 'package.json', path: 'scripts.test',
  reject: 'no test specified', value: 'npm test'
};

test('R4 — jsonField devuelve el valor cuando el campo existe', () => {
  assert.equal(resolve(npmTest, input({ json: { 'package.json': { scripts: { test: 'jest' } } } })), 'npm test');
});

test('R4 — jsonField sin el archivo, sin el campo o con el campo vacío no resuelve', () => {
  assert.equal(resolve(npmTest, input()), null);
  assert.equal(resolve(npmTest, input({ json: { 'package.json': {} } })), null);
  assert.equal(resolve(npmTest, input({ json: { 'package.json': { scripts: {} } } })), null);
  assert.equal(resolve(npmTest, input({ json: { 'package.json': { scripts: { test: '' } } } })), null);
});

test('R4 — jsonField descarta el valor que coincide con reject', () => {
  // El `test` que deja `npm init`: existe pero no corre nada. Tomarlo por bueno es el falso positivo
  // que R2 de la spec 007 prohíbe.
  const json = { 'package.json': { scripts: { test: 'echo "Error: no test specified" && exit 1' } } };
  assert.equal(resolve(npmTest, input({ json })), null);
});

test('R4 — jsonField con reject es insensible a mayúsculas, como la detección de hoy', () => {
  const json = { 'package.json': { scripts: { test: 'echo "NO TEST SPECIFIED"' } } };
  assert.equal(resolve(npmTest, input({ json })), null);
});

test('R4 — jsonField navega rutas anidadas y tolera un tramo que no es objeto', () => {
  const rule = { rule: 'jsonField', file: 'a.json', path: 'x.y.z', value: 'ok' };
  assert.equal(resolve(rule, input({ json: { 'a.json': { x: { y: { z: 1 } } } } })), 'ok');
  assert.equal(resolve(rule, input({ json: { 'a.json': { x: 'no soy objeto' } } })), null);
});

test('R4 — jsonField NO lee propiedades intrínsecas de un valor que no es objeto', () => {
  // Una cadena tiene propiedades: sin cortar en el tramo no-objeto, `x.length` sobre `{x:"abc"}`
  // resolvería a 3 y el campo se daría por configurado. Un config.json con otra forma no es un
  // config vacío — es otra forma, y adivinar ahí es justo lo que R2 de la spec 007 prohíbe.
  // (Mutante M10 de la pasada de mutación: sin este test, quitar la guarda sobrevivía.)
  const rule = { rule: 'jsonField', file: 'a.json', path: 'x.length', value: 'ok' };

  assert.equal(resolve(rule, input({ json: { 'a.json': { x: 'abc' } } })), null);
  assert.equal(resolve(rule, input({ json: { 'a.json': { x: [1, 2, 3] } } })), 'ok', 'un array SÍ es objeto');
});

// ── T4: bySignal ──────────────────────────────────────────────────────────────────────────────

const dartTest = {
  rule: 'bySignal', signal: 'pubspec',
  cases: [{ match: '\\bflutter\\b', value: 'flutter test' }],
  default: 'dart test'
};

test('R4 — bySignal usa el primer caso que coincide', () => {
  assert.equal(resolve(dartTest, input({ signals: { pubspec: 'dependencies:\n  flutter:\n' } })), 'flutter test');
});

test('R4 — bySignal cae al default cuando nada coincide', () => {
  assert.equal(resolve(dartTest, input({ signals: { pubspec: 'name: demo\n' } })), 'dart test');
});

test('R4 — bySignal con la señal ausente cae al default sin lanzar', () => {
  assert.equal(resolve(dartTest, input()), 'dart test');
});

test('R4 — bySignal sin default declarado no resuelve', () => {
  const rule = { rule: 'bySignal', signal: 'python', cases: [{ match: 'pytest', value: 'pytest' }] };
  assert.equal(resolve(rule, input({ signals: { python: 'requests==2.31.0' } })), null);
  assert.equal(resolve(rule, input({ signals: { python: 'pytest==8.0' } })), 'pytest');
});

test('R4 — bySignal respeta el ORDEN de los casos, no el más específico', () => {
  const rule = {
    rule: 'bySignal', signal: 's',
    cases: [{ match: 'a', value: 'primero' }, { match: 'ab', value: 'segundo' }],
    default: ''
  };
  assert.equal(resolve(rule, input({ signals: { s: 'ab' } })), 'primero');
});

// ── T5: byLookup ──────────────────────────────────────────────────────────────────────────────

const stryker = {
  rule: 'byLookup',
  base: { tool: 'stryker', command: 'npx --no-install stryker run', format: 'elements' },
  variants: [
    { id: 'jest', runner: 'jest-runner', deps: ['jest', 'jest-preset-angular'], files: '^jest\\.config\\.(js|ts)$' },
    { id: 'karma', runner: 'karma-runner', deps: ['karma'], files: '^karma\\.conf\\.(js|ts)$' }
  ],
  template: { install: 'npm i -D @stryker-mutator/core @stryker-mutator/{runner}' }
};

test('R4 — byLookup encuentra la variante por dependencia y compone la plantilla', () => {
  assert.deepEqual(resolve(stryker, input({ deps: { jest: '^29.0.0' } })), {
    tool: 'stryker', command: 'npx --no-install stryker run', format: 'elements',
    install: 'npm i -D @stryker-mutator/core @stryker-mutator/jest-runner'
  });
});

test('R4 — byLookup encuentra la variante por archivo de configuración', () => {
  const found = resolve(stryker, input({ entries: ['karma.conf.js', 'src'] }));
  assert.match(found.install, /karma-runner/);
});

test('R4 — byLookup con CERO coincidencias no resuelve', () => {
  assert.equal(resolve(stryker, input({ deps: { lodash: '^4' } })), null);
});

test('R4 — byLookup con VARIAS coincidencias no resuelve: ambiguo es "no sé"', () => {
  // Elegir una a dedo sería exactamente el falso positivo que R2 de la spec 007 prohíbe.
  assert.equal(resolve(stryker, input({ deps: { jest: '^29', karma: '^6' } })), null);
});

test('R4 — byLookup no cuenta dos veces la misma variante por dep Y por archivo', () => {
  const found = resolve(stryker, input({ deps: { jest: '^29' }, entries: ['jest.config.js'] }));
  assert.ok(found, 'una sola variante coincidiendo por dos vías sigue siendo UNA');
  assert.match(found.install, /jest-runner/);
});

test('R4 — byLookup no muta su base entre llamadas', () => {
  resolve(stryker, input({ deps: { jest: '^29' } }));
  assert.deepEqual(stryker.base, { tool: 'stryker', command: 'npx --no-install stryker run', format: 'elements' });
});

// ── T6: lo desconocido ────────────────────────────────────────────────────────────────────────

test('R4 — una regla desconocida no resuelve y no revienta', () => {
  assert.doesNotThrow(() => resolve({ rule: 'telepatia', value: 'x' }, input()));
  assert.equal(resolve({ rule: 'telepatia', value: 'x' }, input()), null);
});

test('R4 — una regla ausente o nula no resuelve', () => {
  assert.equal(resolve(null, input()), null);
  assert.equal(resolve(undefined, input()), null);
  assert.equal(resolve({}, input()), null);
});
