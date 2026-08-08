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
