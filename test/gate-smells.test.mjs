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

// ── bloques de agrupación de pruebas ──────────────────────────────────────────────────────────
//
// `describe` agrupa casos, no es una unidad de diseño: medirlo con el límite de función obliga a
// partir suites cohesivas, y al partirlas se duplican los fixtures y salta la regla de duplicación.
// El límite sigue aplicando a lo que SÍ es una función: cada caso y cada gancho de preparación.

test('lintSource does not measure a describe block against the function limit', async () => {
  const cuerpo = Array.from({ length: 60 }, (_, i) => `  it('caso ${i}', () => { expect(${i}).toBe(${i}); });`);
  const findings = lint('src/precio.spec.ts', [
    "describe('Precio', () => {",
    ...cuerpo,
    '});'
  ].join('\n'));

  assert.deepEqual(
    of(findings, 'function-too-long').map((f) => f.data.name),
    [],
    'el describe agrupa casos; no es una función que revisar'
  );
});

test('lintSource still measures a single test case against the function limit', async () => {
  const cuerpo = Array.from({ length: 50 }, (_, i) => `    const v${i} = ${i};`);
  const findings = lint('src/precio.spec.ts', [
    "describe('Precio', () => {",
    "  it('hace demasiadas cosas', () => {",
    ...cuerpo,
    '  });',
    '});'
  ].join('\n'));

  assert.deepEqual(
    of(findings, 'function-too-long').map((f) => f.data.name),
    ['it'],
    'un caso larguísimo sigue siendo un caso que hace demasiado'
  );
});

// ── atribución a lo que la tarea escribió ─────────────────────────────────────────────────────
//
// Acotar por archivo no basta: añadir dos líneas a un archivo de cuatrocientas traía todos los
// hallazgos que ya vivían ahí. Con las líneas de la tarea, cada hallazgo se puede atribuir.

const lintCon = (file, text, escritas, over = {}) =>
  lintSource(text, { file, limits: limits(over), changedLines: new Set(escritas) });

test('lintSource keeps a finding on a line the task wrote', async () => {
  const findings = lintCon('src/precio.ts', [
    'export const a = 1;',
    'console.log("depuración");'
  ].join('\n'), [2]);

  assert.deepEqual(of(findings, 'debug-output').map((f) => f.line), [2]);
});

test('lintSource drops a finding on a line the task never touched', async () => {
  const findings = lintCon('src/precio.ts', [
    'export const a = 1;',
    'console.log("depuración vieja");'
  ].join('\n'), [1]);

  assert.deepEqual(of(findings, 'debug-output'), [], 'esa línea ya estaba; no es de esta tarea');
});

test('lintSource stays quiet about a long function the task did not enter', async () => {
  const cuerpo = Array.from({ length: 50 }, (_, i) => `  const v${i} = ${i};`);
  const findings = lintCon('src/precio.ts', [
    'export function total() {',
    ...cuerpo,
    '}',
    'export const nueva = () => 1;'
  ].join('\n'), [53]);

  assert.deepEqual(of(findings, 'function-too-long'), []);
});

// Un archivo que YA estaba por encima del límite no es un hallazgo de quien le añade dos líneas.
test('lintSource does not blame the task for a file that was already too long', async () => {
  const texto = Array.from({ length: 303 }, (_, i) => `const v${i} = ${i};`).join('\n');

  const findings = lintCon('src/precio.ts', texto, [10, 11]);

  assert.deepEqual(of(findings, 'file-too-long'), [], '301 líneas ya pasaban del límite sin la tarea');
});

test('lintSource reports a file the task pushed over the limit', async () => {
  const texto = Array.from({ length: 320 }, (_, i) => `const v${i} = ${i};`).join('\n');
  const escritas = Array.from({ length: 30 }, (_, i) => 10 + i);

  const findings = lintCon('src/precio.ts', texto, escritas);

  assert.equal(of(findings, 'file-too-long').length, 1, 'sin esas 30 líneas el archivo cabía');
});

// Sin información de líneas se revisa el archivo entero: es el comportamiento seguro de siempre.
test('lintSource reviews the whole file when no line information is given', async () => {
  const findings = lint('src/precio.ts', 'export const a = 1;\nconsole.log("x");');

  assert.equal(of(findings, 'debug-output').length, 1);
});

// ── deuda de tamaño que ya estaba ─────────────────────────────────────────────────────────────
//
// Las reglas de tamaño no se pueden atribuir por posición: la cabecera de una función de trescientas
// líneas casi nunca se toca. Se atribuyen preguntando si SIN las líneas de la tarea seguirían
// pasándose. Quien mete dos líneas en una función que ya medía 289 no es quien la dejó larga.

test('lintSource does not blame the task for a function that was already too long', async () => {
  const cuerpo = Array.from({ length: 60 }, (_, i) => `  const v${i} = ${i};`);
  const findings = lintCon('src/precio.ts', [
    'export function total() {',
    ...cuerpo,
    '}'
  ].join('\n'), [30, 31]);

  assert.deepEqual(of(findings, 'function-too-long'), [], 'sin esas dos líneas seguía midiendo 60');
});

test('lintSource reports a function the task made too long', async () => {
  const cuerpo = Array.from({ length: 60 }, (_, i) => `  const v${i} = ${i};`);
  const escritas = Array.from({ length: 40 }, (_, i) => 10 + i);
  const findings = lintCon('src/precio.ts', [
    'export function total() {',
    ...cuerpo,
    '}'
  ].join('\n'), escritas);

  assert.deepEqual(of(findings, 'function-too-long').map((f) => f.data.name), ['total']);
});

// El archivo medía 301 —ya pasado— y la tarea le cambió una línea por tres. Contar solo lo añadido
// lo dejaba en 300 justo y le cobraba la deuda al que pasaba por ahí.
test('lintSource counts removed lines when rebuilding the previous size', async () => {
  const texto = Array.from({ length: 303 }, (_, i) => `const v${i} = ${i};`).join('\n');

  const findings = lintSource(texto, {
    file: 'src/precio.ts',
    limits: limits(),
    changedLines: new Set([10, 11, 12]),
    removedLines: 1
  });

  assert.deepEqual(of(findings, 'file-too-long'), [], '303 - 3 + 1 = 301: ya estaba por encima');
});
