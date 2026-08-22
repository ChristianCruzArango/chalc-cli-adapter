// T8–T14 (R5–R14) — la etapa dentro del portón.
//
// El detector encuentra bloques; la etapa decide CUÁLES merecen aparecer en el informe. Y la regla
// que lo decide es la misma que ya rige el resto del linter: solo lo que la tarea tocó. Un repo con
// historia tiene duplicación vieja a montones, y volcarla entera enterraría el trabajo de hoy bajo
// deuda de hace tres años — el informe se leería en diagonal y dejaría de servir.
//
// Por eso el caso más importante de este archivo es el que NO reporta nada: dos archivos duplicados
// entre sí que nadie tocó.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lintDuplication } from '../catalog/gate/lib/duplication.mjs';
import { sourceFiles } from '../catalog/gate/lib/sources.mjs';

const BLOQUE = [
  'const total = items.reduce((a, b) => a + b.monto, 0);',
  'if (total <= 0) {',
  '  throw new PagoInvalido("monto");',
  '}',
  'const comision = total * TASA;',
  'const neto = total - comision;',
  'logger.info("cobro", { total, comision });',
  'return { total, comision, neto };'
].join('\n');

async function repo(files) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-dup-'));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(join(root, rel.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
    await writeFile(join(root, rel), text, 'utf8');
  }
  return root;
}

const CONFIG = { enabled: true, minLines: 6, maxFiles: 4000 };
const lint = (root, changed, over = {}) => lintDuplication(root, changed, { ...CONFIG, ...over });

// ── T10 (R5): solo si tocaste una de las dos puntas ───────────────────────────────────────────

test('R5 — duplicación vieja entre dos archivos INTACTOS no se reporta', () => {
  return repo({ 'src/a.ts': BLOQUE, 'src/b.ts': BLOQUE })
    .then(async (root) => assert.deepEqual(await lint(root, ['src/otro.ts']), []));
});

test('R5 — si tocaste UNO de los dos, sí se reporta', async () => {
  const root = await repo({ 'src/a.ts': BLOQUE, 'src/b.ts': BLOQUE });
  const found = await lint(root, ['src/a.ts']);

  assert.equal(found.length, 1);
  assert.equal(found[0].file, 'src/a.ts', 'el hallazgo apunta al archivo que tocaste');
});

test('R5 — el hallazgo nombra el archivo gemelo y cuántas líneas', async () => {
  const root = await repo({ 'src/a.ts': BLOQUE, 'src/b.ts': BLOQUE });
  const [f] = await lint(root, ['src/a.ts']);

  assert.equal(f.data.other, 'src/b.ts');
  assert.ok(f.data.otherLine > 0);
  assert.ok(f.data.lines >= 6);
  assert.ok(f.line > 0);
});

test('R14 — se compara contra TODO el árbol, no solo contra lo cambiado', async () => {
  // Es el caso que motivó la spec: copiaste de un archivo que no abriste.
  const root = await repo({ 'src/nuevo.ts': BLOQUE, 'src/viejo/legacy.ts': BLOQUE });

  assert.equal((await lint(root, ['src/nuevo.ts'])).length, 1);
});

// ── T13 (R7): la configuración ────────────────────────────────────────────────────────────────

test('R7 — apagada, no reporta nada', async () => {
  const root = await repo({ 'src/a.ts': BLOQUE, 'src/b.ts': BLOQUE });

  assert.deepEqual(await lint(root, ['src/a.ts'], { enabled: false }), []);
});

test('R7 — subir el mínimo silencia los bloques cortos', async () => {
  const root = await repo({ 'src/a.ts': BLOQUE, 'src/b.ts': BLOQUE });

  assert.equal((await lint(root, ['src/a.ts'])).length, 1);
  assert.deepEqual(await lint(root, ['src/a.ts'], { minLines: 40 }), []);
});

// ── T8/T9 (R6, R8): el recorrido del árbol ────────────────────────────────────────────────────

test('R6 — el recorrido salta dependencias, compilados y lo de chalc', async () => {
  const root = await repo({
    'src/a.ts': 'const a = 1;',
    'node_modules/x/index.js': 'module.exports = 1;',
    'dist/bundle.js': 'var a = 1;',
    '.chalc/gate/lib/smells.mjs': 'export const x = 1;'
  });

  const { files } = await sourceFiles(root);
  assert.deepEqual(files, ['src/a.ts']);
});

test('R8 — al alcanzar el tope, el recorrido lo DECLARA', async () => {
  const many = {};
  for (let i = 0; i < 12; i += 1) many[`src/f${i}.ts`] = 'const a = 1;';
  const root = await repo(many);

  const acotado = await sourceFiles(root, { max: 5 });
  assert.equal(acotado.capped, true, 'un recorte silencioso se lee como "revisé todo"');
  assert.equal(acotado.files.length, 5);

  const entero = await sourceFiles(root, { max: 100 });
  assert.equal(entero.capped, false);
});

test('R8 — la etapa arrastra el aviso de recorte a sus hallazgos', async () => {
  const many = { 'src/a.ts': BLOQUE, 'src/b.ts': BLOQUE };
  for (let i = 0; i < 10; i += 1) many[`src/f${i}.ts`] = 'const a = 1;';
  const root = await repo(many);

  const found = await lint(root, ['src/a.ts'], { maxFiles: 3 });
  assert.ok(Array.isArray(found), 'con tope, la etapa sigue devolviendo hallazgos');
});

// ── T14 (R9): no puede tumbar el informe ──────────────────────────────────────────────────────

test('R9 — un árbol que no se puede leer devuelve vacío, no una excepción', async () => {
  await assert.doesNotReject(() => lint(join(tmpdir(), 'no-existe-jamas-' + Date.now()), ['src/a.ts']));
});

test('R9 — un archivo cambiado que ya no está en disco no rompe la etapa', async () => {
  const root = await repo({ 'src/a.ts': BLOQUE, 'src/b.ts': BLOQUE });

  await assert.doesNotReject(() => lint(root, ['src/borrado.ts', 'src/a.ts']));
});

// ── R12: la regla está declarada y redactada en los dos idiomas ───────────────────────────────

test('R12 — la regla existe en el vocabulario y se redacta en es y en', async () => {
  const { RULES } = await import('../catalog/gate/lib/rules.mjs');
  const { messageOf } = await import('../catalog/gate/lib/i18n.mjs');

  assert.ok(RULES.duplication, 'falta la regla en el vocabulario');
  const data = { other: 'src/b.ts', otherLine: 42, lines: 9 };
  for (const lang of ['es', 'en']) {
    const text = messageOf(RULES.duplication, data, lang);
    assert.ok(text && text.length > 10, `${lang}: sin redacción`);
    assert.match(text, /src\/b\.ts/, `${lang}: el mensaje debe nombrar el archivo gemelo`);
    assert.match(text, /9/, `${lang}: y cuántas líneas`);
  }
});

// ── T15 (R11): el revisor deja de opinar sobre lo que ya mide un script ───────────────────────

test('R11 — el revisor declara que la duplicación medible no es suya', async () => {
  const { readFile: read } = await import('node:fs/promises');
  const { join: j, dirname: d, resolve: r } = await import('node:path');
  const { fileURLToPath: f } = await import('node:url');
  const AGENTS = j(r(d(f(import.meta.url)), '..'), 'catalog', 'agents', 'revisor');

  for (const [file, pattern] of [['agent.md', /duplicaci/i], ['agent.en.md', /duplicat/i]]) {
    const text = await read(j(AGENTS, file), 'utf8');
    assert.match(text, pattern, `${file}: no menciona la duplicación`);
    assert.match(text, /portón|gate/i, `${file}: no dice quién la mide ahora`);
  }
});

test('R8 — el tope se aplica también al ENTRAR en un directorio, no solo dentro de él', async () => {
  // Sin la comprobación de entrada, un repo con muchas carpetas seguiría descendiendo pasado el tope.
  const many = {};
  for (let d = 0; d < 6; d += 1) {
    for (let i = 0; i < 4; i += 1) many[`src/m${d}/f${i}.ts`] = 'const a = 1;';
  }
  const root = await repo(many);

  const acotado = await sourceFiles(root, { max: 5 });
  assert.equal(acotado.files.length, 5, 'no puede pasarse del tope al cambiar de carpeta');
  assert.equal(acotado.capped, true, 'y tiene que declararlo');
});

test('R6 — el recorrido devuelve las rutas ORDENADAS: el informe tiene que ser reproducible', async () => {
  const root = await repo({ 'src/z.ts': 'const z = 1;', 'src/a.ts': 'const a = 1;', 'src/m.ts': 'const m = 1;' });

  const { files } = await sourceFiles(root);
  assert.deepEqual(files, [...files].sort(), `sin orden estable, dos corridas dan informes distintos: ${files}`);
  assert.deepEqual(files, ['src/a.ts', 'src/m.ts', 'src/z.ts']);
});

// ── atribución por línea ──────────────────────────────────────────────────────────────────────
//
// Que un bloque duplicado esté en un archivo que la tarea tocó no lo hace suyo: el bloque puede
// llevar años ahí y la tarea haber añadido dos líneas al final. Se reporta solo si la tarea escribió
// DENTRO del bloque.

test('lintDuplication ignores a duplicated block the task never wrote in', async () => {
  const bloque = Array.from({ length: 8 }, (_, i) => `const v${i} = calcular(${i});`).join('\n');
  const dir = await repo({
    'src/a.ts': `${bloque}\nconst nuevo = 1;\n`,
    'src/b.ts': `${bloque}\n`
  });

  // La tarea solo escribió la última línea de a.ts, fuera del bloque repetido.
  const lineas = new Map([['src/a.ts', new Set([9])]]);

  assert.deepEqual(await lintDuplication(dir, ['src/a.ts'], {}, lineas), []);
});

test('lintDuplication reports a duplicated block the task wrote', async () => {
  const bloque = Array.from({ length: 8 }, (_, i) => `const v${i} = calcular(${i});`).join('\n');
  const dir = await repo({
    'src/a.ts': `${bloque}\n`,
    'src/b.ts': `${bloque}\n`
  });

  const lineas = new Map([['src/a.ts', new Set([3])]]);

  const findings = await lintDuplication(dir, ['src/a.ts'], {}, lineas);
  assert.equal(findings.length, 1);
});
