// T26 (R17) — marco bilingüe del portón.
//
// El portón habla el idioma del spec. Para eso las etapas emiten DATOS (`rule` + `data`) y el marco
// redacta: un hallazgo es "archivo, línea, regla y cifras", no una frase. Así el mismo hallazgo se
// lee en es o en en sin duplicar lógica, y los tests de cada etapa comprueban cifras en vez de prosa
// —que es lo que hay que comprobar—.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME, MESSAGES, frameOf, messageOf } from '../catalog/gate/lib/i18n.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';

// Rutas de claves anidadas, para comparar dos marcos sin depender del orden.
function keyPaths(obj, prefix = '') {
  const paths = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) paths.push(...keyPaths(value, path));
    else paths.push(path);
  }
  return paths.sort();
}

test('the gate frame has exact key parity between es and en', async () => {
  assert.deepEqual(keyPaths(FRAME.es), keyPaths(FRAME.en));
});

// Si una etapa estrena una regla y nadie la redacta, la evidencia mostraría un código suelto.
test('every rule the gate can emit has a message in both languages', async () => {
  for (const code of Object.values(RULES)) {
    assert.equal(typeof MESSAGES.es[code], 'function', `falta el mensaje es de "${code}"`);
    assert.equal(typeof MESSAGES.en[code], 'function', `falta el mensaje en de "${code}"`);
  }
});

test('the message tables carry no rule that does not exist', async () => {
  const codes = new Set(Object.values(RULES));
  for (const lang of ['es', 'en']) {
    for (const code of Object.keys(MESSAGES[lang])) {
      assert.ok(codes.has(code), `"${code}" está redactado en ${lang} pero ninguna etapa lo emite`);
    }
  }
});

// ── redacción ─────────────────────────────────────────────────────────────────────────────────

test('messageOf interpolates the data of the finding', async () => {
  const install = 'npm i -D @stryker-mutator/core @stryker-mutator/jest-runner';

  assert.match(messageOf(RULES.notInstalled, { tool: 'stryker', install }, 'es'), /npm i -D @stryker-mutator\/core/);
  assert.match(messageOf(RULES.notInstalled, { tool: 'stryker', install }, 'en'), /npm i -D @stryker-mutator\/core/);
});

test('messageOf words the missing contract route according to the role of the repo', async () => {
  const data = { method: 'POST', path: '/api/carrito/{id}/items', missing: ['items'], role: 'back' };

  assert.match(messageOf(RULES.contractRouteMissing, data, 'es'), /expone/);
  assert.match(messageOf(RULES.contractRouteMissing, { ...data, role: 'front' }, 'es'), /consume/);
  assert.match(messageOf(RULES.contractRouteMissing, data, 'en'), /expose/);
  assert.match(messageOf(RULES.contractRouteMissing, { ...data, role: 'front' }, 'en'), /consume/);
});

test('messageOf writes both languages differently for the same finding', async () => {
  const data = { lines: 412, limit: 300 };

  const es = messageOf(RULES.fileTooLong, data, 'es');
  const en = messageOf(RULES.fileTooLong, data, 'en');

  assert.notEqual(es, en);
  for (const text of [es, en]) {
    assert.match(text, /412/);
    assert.match(text, /300/);
  }
});

// ── T7 (spec 013, R14): las dos reglas del alcance ────────────────────────────────────────────
//
// Son las únicas dos reglas del portón que no hablan del código, sino de la propia revisión: una
// dice que no se pudo saber QUÉ revisar, y la otra que no había NADA que revisar. Se parecen en
// pantalla y son opuestas — la primera es una duda que bloquea, la segunda un hecho que se informa—,
// así que la redacción tiene que separarlas sin que haga falta leer la spec.

test('the gate knows how to name a scope it could not determine, and an empty one', async () => {
  assert.equal(typeof RULES.scopeUndetermined, 'string');
  assert.equal(typeof RULES.scopeEmpty, 'string');
  assert.notEqual(RULES.scopeUndetermined, RULES.scopeEmpty);
});

// Los dos hallazgos no cuelgan de ningún archivo, así que en el informe se muestran bajo el nombre
// de su etapa. Sin ese nombre traducido, la línea saldría con el identificador interno en crudo.
test('the report can name the scope stage in both languages', async () => {
  assert.equal(typeof FRAME.es.stages.scope, 'string');
  assert.equal(typeof FRAME.en.stages.scope, 'string');
  assert.notEqual(FRAME.es.stages.scope, FRAME.en.stages.scope);
});

// El hallazgo tiene que decir QUÉ HACER. Un "no se pudo determinar el alcance" a secas invita a la
// salida de siempre —revisarlo todo—, que es justo lo que R4b prohíbe.
test('the undetermined scope finding says how to fix it, in both languages', async () => {
  const es = messageOf(RULES.scopeUndetermined, {}, 'es');
  const en = messageOf(RULES.scopeUndetermined, {}, 'en');

  for (const text of [es, en]) assert.match(text, /git/, 'nombra la fuente que falta');
  assert.notEqual(es, en);
});

// El alcance vacío lleva la referencia contra la que se midió: sin ella, "no cambió nada" es
// incomprobable — nadie puede saber desde cuándo.
test('the empty scope finding carries the reference it measured against', async () => {
  const data = { from: 'a1b2c3d4e5' };
  const es = messageOf(RULES.scopeEmpty, data, 'es');
  const en = messageOf(RULES.scopeEmpty, data, 'en');

  for (const text of [es, en]) assert.match(text, /a1b2c3d4e5/);
  assert.notEqual(es, en);
});

// Sin línea base sellada no hay referencia que citar, y la frase no puede quedarse coja ni mentir
// con un hueco vacío entre comillas.
test('the empty scope finding still reads well with no reference', async () => {
  for (const lang of ['es', 'en']) {
    const text = messageOf(RULES.scopeEmpty, {}, lang);
    assert.ok(text.length > 20, `la frase ${lang} se queda coja sin referencia`);
    assert.doesNotMatch(text, /""|undefined/, 'ni comillas vacías ni undefined');
  }
});

// ── bordes ────────────────────────────────────────────────────────────────────────────────────

test('frameOf falls back to english for a language it does not have', async () => {
  assert.equal(frameOf('pt'), FRAME.en);
  assert.equal(frameOf(''), FRAME.en);
  assert.equal(frameOf('es'), FRAME.es);
});

// Una regla sin redactar no puede dejar la evidencia en blanco: el código es peor que una frase,
// pero infinitamente mejor que un hueco donde iba un hallazgo.
test('messageOf falls back to the rule code instead of leaving a gap', async () => {
  assert.equal(messageOf('regla-que-no-existe', {}, 'es'), 'regla-que-no-existe');
});
