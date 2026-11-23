// Spec 030 (rojo sellado), T3 — tests que no prueban nada (R9): saltados, enfocados, con una aserción trivial o
// sin ninguna. Pasan, y la suite sigue «en verde». Son patrones por línea y por bloque, no un parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { lintTestSource, lintTests } from '../catalog/gate/lib/testsmells.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { MESSAGES } from '../catalog/gate/lib/i18n.mjs';

const lint = (text, file = 'test/a.test.ts') => lintTestSource(text, { file }).map((f) => [f.line, f.rule]);
const only = (text, rule, file) => lint(text, file).filter(([, r]) => r === rule).map(([line]) => line);
const GOOD = "it('suma', () => {\n  expect(suma(1, 2)).toBe(3);\n});\n";

test('un test normal no tiene hallazgos', () => {
  assert.deepEqual(lint(GOOD), []);
  assert.deepEqual(lint("test('a', async () => {\n  await assert.rejects(() => pago());\n});\n"), []);
});

test('R9: un test saltado se reporta en su línea, en cada lenguaje', () => {
  for (const line of ["it.skip('a', () => {", "test.skip('a', () => {", "describe.skip('a', () => {", "xit('a', () => {", "xdescribe('a', () => {"]) {
    assert.deepEqual(only(`// uno\n${line}\n  expect(1).toBe(2);\n});\n`, RULES.testSkipped), [2], line);
  }
  assert.deepEqual(only('@pytest.mark.skip\ndef test_a():\n    assert f() == 1\n', RULES.testSkipped, 'tests/test_a.py'), [1]);
  assert.deepEqual(only('@unittest.skip("luego")\ndef test_a(self):\n    self.assertEqual(f(), 1)\n', RULES.testSkipped, 'tests/test_a.py'), [1]);
  assert.deepEqual(only('[Fact(Skip = "luego")]\npublic void A() { Assert.Equal(1, F()); }\n', RULES.testSkipped, 'PagoTests.cs'), [1]);
  assert.deepEqual(only('@Disabled\n@Test void a() { assertEquals(1, f()); }\n', RULES.testSkipped, 'PagoTest.java'), [1]);
});

test('R9: saltar un test por plataforma con una condición no es un test saltado', () => {
  assert.deepEqual(only("test('chmod', { skip: process.platform === 'win32' }, () => {\n  assert.ok(x());\n});\n", RULES.testSkipped), []);
});

test('R9: un test enfocado se reporta: deja sin correr a todos los demás', () => {
  for (const line of ["it.only('a', () => {", "test.only('a', () => {", "describe.only('a', () => {", "fit('a', () => {", "fdescribe('a', () => {"]) {
    assert.deepEqual(only(`${line}\n  expect(1).toBe(2);\n});\n`, RULES.testFocused), [1], line);
  }
});

test('R9: una aserción trivial se reporta en su línea', () => {
  for (const line of ['expect(true).toBe(true);', 'expect(true).toBeTruthy();', 'expect(1).toEqual(1);', 'assert(true);', 'assert.ok(true);', 'assert.equal(1, 1);']) {
    assert.deepEqual(only(`it('a', () => {\n  ${line}\n});\n`, RULES.testTrivialAssert), [2], line);
  }
  assert.deepEqual(only('def test_a():\n    assert True\n', RULES.testTrivialAssert, 'tests/test_a.py'), [2]);
  assert.deepEqual(only('public void A() { Assert.True(true); }\n', RULES.testTrivialAssert, 'PagoTests.cs'), [1]);
  assert.deepEqual(only(GOOD + "it('b', () => { expect(ok).toBe(true); });\n", RULES.testTrivialAssert), [], 'comparar un valor real con true no es trivial');
});

test('R9: un caso de test sin ninguna aserción se reporta en la línea donde empieza', () => {
  const text = [
    "it('con aserción', () => {", '  expect(f()).toBe(1);', '});',
    "it('sin aserción', () => {", '  const x = f();', '  console.log(x);', '});',
    "test('tampoco', async () => {", '  await f();', '});'
  ].join('\n');
  assert.deepEqual(only(text, RULES.testNoAssert), [4, 8]);
});

test('R9: cuenta como aserción lo que afirma algo, también por un ayudante', () => {
  for (const body of ['expect(x).toBe(1);', 'assert.equal(x, 1);', 'x.should.equal(1);', 'await assertPago(x);', 'verifyTotal(x);', 'await expect(f()).rejects.toThrow();', "assert.throws(() => f('(')); // un ) en el texto"]) {
    assert.deepEqual(only(`it('a', () => {\n  ${body}\n});\n`, RULES.testNoAssert), [], body);
  }
});

test('R9: paréntesis y llaves dentro de textos no confunden dónde acaba el caso', () => {
  const text = "it('a ) }', () => {\n  const s = \"}) (\";\n  expect(s).toBe('x');\n});\nit('b', () => {\n  f(`${1}) }`);\n});\n";
  assert.deepEqual(only(text, RULES.testNoAssert), [5]);
});

test('R9: «sin aserción» solo se busca en JS y TS; en otros lenguajes no se afirma lo que no se sabe leer', () => {
  assert.deepEqual(only('def test_a():\n    f()\n', RULES.testNoAssert, 'tests/test_a.py'), []);
});

test('R9: con las líneas de la tarea, solo se reporta lo que la tarea tocó', () => {
  const text = "it.skip('viejo', () => {\n  expect(1).toBe(2);\n});\nit.only('nuevo', () => {\n  expect(1).toBe(2);\n});\n";
  const found = lintTestSource(text, { file: 'test/a.test.ts', changedLines: [4, 5, 6] }).map((f) => [f.line, f.rule]);
  assert.deepEqual(found, [[4, RULES.testFocused]]);
});

test('R9: lintTests mira solo los archivos de test del alcance, y uno borrado no rompe', async (t) => {
  const root = await tempDir(t, 'chalc-030-smells-');
  const files = { 'test/a.test.ts': "it.only('a', () => {\n  expect(f()).toBe(1);\n});\n", 'src/a.ts': "it.only('no es un test', () => {});\n" };
  for (const [rel, content] of Object.entries(files)) { await mkdir(dirname(join(root, rel)), { recursive: true }); await writeFile(join(root, rel), content); }
  const found = await lintTests(['test/a.test.ts', 'src/a.ts', 'test/borrado.test.ts'], { root });
  assert.deepEqual(found.map((f) => [f.file, f.line, f.rule]), [['test/a.test.ts', 1, RULES.testFocused]]);
});

test('cada regla tiene su mensaje en es y en', () => {
  for (const key of ['testSkipped', 'testFocused', 'testTrivialAssert', 'testNoAssert']) {
    assert.equal(typeof RULES[key], 'string', key);
    assert.notEqual(MESSAGES.es[RULES[key]]({}, 'es'), MESSAGES.en[RULES[key]]({}, 'en'), key);
  }
});
