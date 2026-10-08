// spec 007 · R6 — en Dart, una llamada no es una función.
//
// Un árbol de widgets de Flutter es una sola expresión hecha de llamadas a constructores: `Text(`,
// `const SizedBox(`, `return Container(`. Con la forma `Nombre(` al inicio de línea, el lector las
// tomaba por firmas de función, y cada pantalla del repo móvil salía con hallazgos falsos: «"Text"
// recibe 5 parámetros», «"SizedBox" tiene 59 líneas». Lo que distingue una definición de una llamada
// es lo que viene detrás del paréntesis: una definición abre cuerpo (`{`, `=>`, `async`, o `:` en la
// lista de inicializadores); una llamada sigue con `,`, `;` o `)`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { lintSource } from '../catalog/gate/lib/smells.mjs';

const limits = { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3 };
const lint = (text) => lintSource(text, { file: 'lib/app/shell/credit.dart', limits });
const rulesOf = (findings) => findings.map((f) => [f.line, f.rule, f.data.name]);

// Un widget con un árbol largo de llamadas con muchos argumentos con nombre, como los de verdad.
const WIDGET = [
  "import 'package:flutter/material.dart';",
  '',
  'class Credit extends StatelessWidget {',
  '  const Credit({super.key, required this.name, required this.site, this.dense = false, this.onTap});',
  '',
  '  final String name;',
  '  final Uri site;',
  '  final bool dense;',
  '  final VoidCallback? onTap;',
  '',
  '  @override',
  '  Widget build(BuildContext context) {',
  '    return Container(',
  '      width: double.infinity,',
  '      padding: const EdgeInsets.fromLTRB(8, 6, 10, 6),',
  '      child: Row(',
  '        children: [',
  '          const SizedBox(width: 10),',
  '          Text(',
  '            name,',
  '            maxLines: 1,',
  '            overflow: TextOverflow.ellipsis,',
  '            softWrap: false,',
  '            style: const TextStyle(fontSize: 11),',
  '          ),',
  '        ],',
  '      ),',
  '    );',
  '  }',
  '}'
].join('\n');

test('R6: widget constructor calls in a Flutter tree are not functions', async () => {
  assert.deepEqual(rulesOf(lint(WIDGET)), []);
});

// Lo que SÍ es una función sigue midiéndose, con cada forma de cuerpo que tiene Dart.
test('R6: real Dart functions are still measured, whatever their body looks like', async () => {
  const cases = [
    ['void pagar(int a, int b, int c, int d, int e) {\n}', 'pagar'],
    ['int total(int a, int b, int c, int d, int e) => a + b;', 'total'],
    ['Future<void> cargar(int a, int b, int c, int d, int e) async {\n}', 'cargar'],
    ['Stream<int> contar(int a, int b, int c, int d, int e) async* {\n}', 'contar']
  ];
  for (const [text, name] of cases) {
    assert.deepEqual(rulesOf(lint(text)), [[1, 'too-many-params', name]], text);
  }
});

test('R6: a constructor with an initializer list and a body is a function', async () => {
  const text = 'class A {\n  A(int a, int b, int c, int d, int e) : assert(a > 0) {\n  }\n}';
  assert.deepEqual(rulesOf(lint(text)), [[2, 'too-many-params', 'A']]);
});

// Un `build` largo es un hallazgo real: es la función, no las llamadas que contiene.
test('R6: a long build method is reported once, under its own name', async () => {
  const body = Array.from({ length: 45 }, (_, i) => `      Text('fila ${i}'),`).join('\n');
  const text = `class A extends StatelessWidget {\n  @override\n  Widget build(BuildContext context) => Column(\n    children: [\n${body}\n    ],\n  );\n}`;

  const long = lint(text).filter((f) => f.rule === 'function-too-long');
  assert.deepEqual(long.map((f) => f.data.name), ['build']);
});

// La corrección es de Dart. En JS, `it('…', () => {…})` se sigue midiendo como hasta ahora.
test('R6: other languages keep measuring call-shaped blocks as before', async () => {
  const body = Array.from({ length: 45 }, (_, i) => `  expect(${i}).toBe(${i});`).join('\n');
  const text = `it('suma', () => {\n${body}\n});`;

  const long = lintSource(text, { file: 'test/suma.test.ts', limits }).filter((f) => f.rule === 'function-too-long');
  assert.deepEqual(long.map((f) => f.data.name), ['it']);
});

// En Dart, `void main() { … }` es el envoltorio obligatorio de toda suite de tests: es un índice,
// igual que `group`. Medirlo con el límite de función obliga a partir suites cohesivas.
test('R6: the main of a Dart test file is a suite index, not a function to measure', async () => {
  const cases = Array.from({ length: 45 }, (_, i) => `  test('caso ${i}', () => expect(${i}, ${i}));`).join('\n');
  const text = `void main() {\n${cases}\n}`;

  const inTest = lintSource(text, { file: 'test/finance/totals_test.dart', limits });
  assert.deepEqual(inTest.filter((f) => f.rule === 'function-too-long'), []);

  // Fuera de los tests, un `main` largo sigue siendo una función larga.
  const inApp = lintSource(text, { file: 'lib/main.dart', limits });
  assert.deepEqual(inApp.filter((f) => f.rule === 'function-too-long').map((f) => f.data.name), ['main']);
});
