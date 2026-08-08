// T15 (R6) — linter de smells medibles y "una cosa por archivo".
//
// Solo entra aquí lo que se puede señalar con archivo y línea. Lo opinable (¿es correcta esta
// abstracción?) es del revisor, no del portón: si el portón opinara, volvería a ser un juicio que
// nadie puede verificar, que es justo lo que la spec viene a quitar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { lintSource, lintChanged } from '../catalog/gate/lib/smells.mjs';

const limits = (over = {}) => ({ maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3, ...over });

// Hallazgos de una regla concreta.
const of = (findings, rule) => findings.filter((f) => f.rule === rule);

const lint = (file, text, over = {}) => lintSource(text, { file, limits: limits(over) });

// ── una cosa por archivo ──────────────────────────────────────────────────────────────────────

test('lintSource reports a second exported interface in the same file', async () => {
  const findings = lint('src/precio.ts', [
    'export interface Precio { valor: number }',
    'export interface Total { valor: number }'
  ].join('\n'));

  const found = of(findings, 'one-thing-per-file');
  assert.equal(found.length, 1, 'el hallazgo va en la declaración que sobra, no en la primera');
  assert.equal(found[0].line, 2);
  assert.equal(found[0].file, 'src/precio.ts');
});

test('lintSource reports an exported class living next to an exported type', async () => {
  const findings = lint('src/precio.ts', [
    'export type Moneda = "COP" | "USD";',
    '',
    'export class Precio {}'
  ].join('\n'));

  assert.equal(of(findings, 'one-thing-per-file').length, 1);
  assert.equal(of(findings, 'one-thing-per-file')[0].line, 3);
});

// Un StatefulWidget de Flutter OBLIGA a una segunda clase para su State. No es una decisión de
// diseño y va con `_` (privada): contarla sería un falso positivo en cada pantalla del repo móvil.
test('lintSource does not count private companion classes', async () => {
  const findings = lint('lib/pagina.dart', [
    'class MiPagina extends StatefulWidget {',
    '  @override',
    '  State<MiPagina> createState() => _MiPaginaState();',
    '}',
    '',
    'class _MiPaginaState extends State<MiPagina> {',
    '}'
  ].join('\n'));

  assert.deepEqual(of(findings, 'one-thing-per-file'), []);
});

test('lintSource reports two public types in a C# file', async () => {
  const findings = lint('Domain/Precio.cs', [
    'public interface IPrecio { }',
    'public class Precio : IPrecio { }'
  ].join('\n'));

  assert.equal(of(findings, 'one-thing-per-file').length, 1);
  assert.equal(of(findings, 'one-thing-per-file')[0].line, 2);
});

// La constitución lo dice aparte: interfaces, DTOs y types NUNCA dentro de un servicio o componente,
// aunque no estén exportados — ahí es donde acaban por comodidad y donde nadie los vuelve a mirar.
test('lintSource reports a type declared inside a service file', async () => {
  const findings = lint('src/precio.service.ts', [
    'interface Tarifa { valor: number }',
    '',
    'export class PrecioService {',
    '  calcular(): Tarifa { return { valor: 1 }; }',
    '}'
  ].join('\n'));

  const found = of(findings, 'type-in-service');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
});

test('lintSource leaves a type alone when the file declares no service or component', async () => {
  const findings = lint('src/tarifa.ts', 'export interface Tarifa { valor: number }');

  assert.deepEqual(of(findings, 'type-in-service'), []);
});

// ── smells medibles ───────────────────────────────────────────────────────────────────────────

test('lintSource reports a file longer than the configured limit', async () => {
  const findings = lint('src/largo.ts', 'const x = 1;\n'.repeat(12), { maxFileLines: 10 });

  const found = of(findings, 'file-too-long');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.deepEqual(found[0].data, { lines: 12, limit: 10 });
});

test('lintSource reports a function longer than the configured limit', async () => {
  const findings = lint('src/total.js', [
    'export function total(a) {',
    '  const x = 1;',
    '  const y = 2;',
    '  const z = 3;',
    '  return a + x + y + z;',
    '}'
  ].join('\n'), { maxFunctionLines: 3 });

  const found = of(findings, 'function-too-long');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1, 'se señala la firma: es donde se corta la función');
});

test('lintSource counts the parameters of a signature split across lines', async () => {
  const findings = lint('src/crear.js', [
    'function crear(',
    '  a,',
    '  b,',
    '  c,',
    '  d,',
    '  e',
    ') {',
    '  return a;',
    '}'
  ].join('\n'));

  const found = of(findings, 'too-many-params');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.equal(found[0].data.params, 5);
});

test('lintSource reports nesting deeper than the configured limit', async () => {
  const findings = lint('src/hondo.js', [
    'function f(a) {',
    '  if (a) {',
    '    for (const x of a) {',
    '      while (x) {',
    '        return 1;',
    '      }',
    '    }',
    '  }',
    '}'
  ].join('\n'), { maxDepth: 2 });

  const found = of(findings, 'deep-nesting');
  assert.equal(found.length, 1, 'se reporta el punto donde se cruza el límite, no cada línea honda');
  assert.equal(found[0].line, 4);
});

test('lintSource reports an empty catch block', async () => {
  const findings = lint('src/fallo.ts', [
    'try {',
    '  hacer();',
    '} catch (e) {',
    '}'
  ].join('\n'));

  const found = of(findings, 'empty-catch');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 3);
});

test('lintSource leaves a catch that does something', async () => {
  const findings = lint('src/fallo.ts', [
    'try {',
    '  hacer();',
    '} catch (e) {',
    '  registrar(e);',
    '}'
  ].join('\n'));

  assert.deepEqual(of(findings, 'empty-catch'), []);
});

test('lintSource reports debug output left in the code', async () => {
  assert.equal(of(lint('src/a.ts', 'console.log(total);'), 'debug-output')[0].line, 1);
  assert.equal(of(lint('lib/a.dart', 'print(total);'), 'debug-output')[0].line, 1);
});

test('lintSource reports the any type only where the language has one', async () => {
  const found = of(lint('src/a.ts', 'export function f(x: any): number { return 1; }'), 'any-type');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);

  assert.deepEqual(of(lint('src/a.js', 'const any = 1; // any'), 'any-type'), []);
});

// Sin esto el linter sería inservible: marcaría el ejemplo de un comentario y el texto de un mensaje.
test('lintSource ignores matches inside comments and strings', async () => {
  const findings = lint('src/a.ts', [
    '// console.log(total)',
    'const aviso = "usa console.log(x) para depurar";',
    '/* console.log(otro) */',
    'export const z = 1;'
  ].join('\n'));

  assert.deepEqual(of(findings, 'debug-output'), []);
});

// El límite es lo permitido, no lo prohibido: con `maxFileLines: 300`, un archivo de 300 líneas está
// bien. Un off-by-one aquí es de los que hacen que se desactive el linter entero — el usuario
// configura un número y la herramienta le grita justo en ese número.
test('lintSource treats the configured limit as allowed, not as exceeded', async () => {
  const exactamente = 'const x = 1;\n'.repeat(10);
  assert.deepEqual(of(lint('src/justo.ts', exactamente, { maxFileLines: 10 }), 'file-too-long'), []);
  assert.equal(of(lint('src/justo.ts', exactamente, { maxFileLines: 9 }), 'file-too-long').length, 1);

  const seisLineas = [
    'export function total(a) {', '  const x = 1;', '  const y = 2;', '  const z = 3;',
    '  return a + x + y + z;', '}'
  ].join('\n');
  assert.deepEqual(of(lint('src/total.js', seisLineas, { maxFunctionLines: 6 }), 'function-too-long'), []);
  assert.equal(of(lint('src/total.js', seisLineas, { maxFunctionLines: 5 }), 'function-too-long').length, 1);

  const cincoParams = 'function crear(a, b, c, d, e) { return a; }';
  assert.deepEqual(of(lint('src/crear.js', cincoParams, { maxParams: 5 }), 'too-many-params'), []);
  assert.equal(of(lint('src/crear.js', cincoParams, { maxParams: 4 }), 'too-many-params').length, 1);
});

test('lintSource honours raised limits', async () => {
  const text = 'const x = 1;\n'.repeat(12);

  assert.deepEqual(of(lint('src/largo.ts', text, { maxFileLines: 400 }), 'file-too-long'), []);
});

// ── sobre los archivos cambiados ──────────────────────────────────────────────────────────────

test('lintChanged reads the changed files and skips what it cannot lint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-smells-'));
  const write = async (rel, text) => {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), text, 'utf8');
  };
  await write('src/precio.ts', 'export interface A {}\nexport interface B {}\n');
  await write('README.md', '# console.log(x)\n');

  // `src/borrado.ts` entró en el diff pero ya no está: un archivo borrado no puede tumbar la corrida.
  const findings = await lintChanged(['src/precio.ts', 'README.md', 'src/borrado.ts'], { root: dir, limits: limits() });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'src/precio.ts');
  assert.equal(findings[0].rule, 'one-thing-per-file');
});
