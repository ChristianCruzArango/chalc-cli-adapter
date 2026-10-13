// T1 (spec 017, R13, R14) — que los dos README no se desincronicen en silencio.
//
// CLAUDE.md exige que `README.md` (inglés) y `README.es.md` (español) tengan la misma estructura:
// mismas secciones, tablas y diagramas; solo cambia el idioma de la prosa. Hasta ahora eso dependía de
// la memoria de quien editaba. Aquí se compara lo que NO es idioma: niveles de encabezado, forma de
// cada tabla, bloques de código con su etiqueta y las opciones de línea de comandos de cada bloque.
// Las rutas de ejemplo y las etiquetas de los diagramas sí cambian con el idioma, así que no se miran.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readmeFacts, firstDifference } from './helpers/readme-facts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(join(ROOT, name), 'utf8');

const FENCE = '```';
const BASE = [
  '# Título',
  '',
  '> **Español** · [English](README.md)',
  '',
  '## Uso',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  `${FENCE}bash`,
  'chalc init angular mi-app --description "algo"   # comentario con --falso',
  `${FENCE}`,
  '',
  '### Detalle'
].join('\n');

const differs = (other) => firstDifference(readmeFacts(BASE), readmeFacts(other));

test('R13: identical structure in two languages has no difference', () => {
  const english = BASE
    .replace('# Título', '# Title')
    .replace('## Uso', '## Usage')
    .replace('mi-app --description "algo"', 'my-app --description "something"')
    .replace('# comentario con --falso', '# a comment with --fake');
  assert.equal(differs(english), '');
});

test('R13: a different heading level is reported', () => {
  assert.match(differs(BASE.replace('### Detalle', '## Detalle')), /heading/i);
});

test('R13: a missing heading is reported', () => {
  assert.match(differs(BASE.replace('\n### Detalle', '')), /heading/i);
});

test('R13: a table with another number of rows is reported', () => {
  assert.match(differs(BASE.replace('| 1 | 2 |', '| 1 | 2 |\n| 3 | 4 |')), /table/i);
});

test('R13: a table with another number of columns is reported', () => {
  assert.match(differs(BASE.replace('| 1 | 2 |', '| 1 | 2 | 3 |')), /table/i);
});

test('R13: an escaped pipe inside a cell is not a column', () => {
  assert.equal(differs(BASE.replace('| 1 | 2 |', '| `es\\|en` | 2 |')), '');
});

test('R13: a missing table is reported', () => {
  assert.match(differs(BASE.replace(/\| a[\s\S]*?\| 1 \| 2 \|\n/, '')), /table/i);
});

test('R13: a code block with another language tag is reported', () => {
  assert.match(differs(BASE.replace(`${FENCE}bash`, `${FENCE}sh`)), /block/i);
});

test('R13: a missing code block is reported', () => {
  assert.match(differs(BASE.replace(/```bash[\s\S]*?```\n/, '')), /block/i);
});

test('R13: a block whose command-line options differ is reported', () => {
  assert.match(differs(BASE.replace('--description', '--desc')), /option/i);
});

test('R13: options inside a comment do not count', () => {
  assert.equal(differs(BASE.replace('con --falso', 'sin opciones')), '');
});

test('R13: a fenced block is not read as headings or tables', () => {
  const facts = readmeFacts([`${FENCE}md`, '# no es encabezado', '| ni | tabla |', FENCE].join('\n'));
  assert.deepEqual(facts.headings, []);
  assert.deepEqual(facts.tables, []);
  assert.equal(facts.blocks.length, 1);
});

test('R13: the difference names where it is', () => {
  assert.match(differs(BASE.replace('--description', '--desc')), /#1\b/);
});

// Los casos de abajo salen de la pasada de mutación: cada uno fija un borde que ningún caso anterior
// distinguía (un `^` de más o de menos, un `trim`, una opción de un solo guion…).

test('R13: the facts of the base document are exactly these', () => {
  assert.deepEqual(readmeFacts(BASE), {
    headings: [1, 2, 3],
    tables: [[2, 2, 2]],
    blocks: [{ lang: 'bash', options: ['--description'] }],
    selector: '> **Español** · [English](README.md)'
  });
});

test('R13: no input reads as an empty document', () => {
  assert.deepEqual(readmeFacts(undefined), { headings: [], tables: [], blocks: [], selector: '' });
});

test('R13: a short option (-f) is compared too', () => {
  assert.match(differs(BASE.replace('mi-app', 'mi-app -f')), /option/i);
});

test('R13: a comment line at the start of a block does not count', () => {
  assert.equal(differs(BASE.replace(`${FENCE}bash\n`, `${FENCE}bash\n# un comentario con --x\n`)), '');
});

test('R13: one more line without options (a comment, a blank) is not structure', () => {
  assert.equal(differs(BASE.replace(`${FENCE}bash\n`, `${FENCE}bash\n# solo en un idioma\n\n`)), '');
});

test('R13: a pound sign, a fence or a pipe in the middle of prose is not structure', () => {
  const prose = BASE.replace('## Uso', '## Uso\n\nver # aquí, el ```js de abajo y a | b');
  assert.deepEqual(readmeFacts(prose).headings, [1, 2, 3]);
  assert.equal(readmeFacts(prose).blocks.length, 1);
  assert.equal(readmeFacts(prose).tables.length, 1);
});

test('R13: indentation and the trailing pipe of a row are not columns', () => {
  const loose = BASE.replace('| 1 | 2 |', '  | 1 | 2');
  assert.deepEqual(readmeFacts(loose).tables, [[2, 2, 2]]);
});

test('R14: the selector is read without trailing spaces', () => {
  assert.equal(readmeFacts(BASE.replace('(README.md)', '(README.md)   ')).selector, '> **Español** · [English](README.md)');
});

test('R14: the selector line is the first quote after the title', () => {
  assert.equal(readmeFacts(BASE).selector, '> **Español** · [English](README.md)');
});

test('R13: README.md and README.es.md have the same structure', async () => {
  const [en, es] = await Promise.all([read('README.md'), read('README.es.md')]);
  assert.equal(firstDifference(readmeFacts(en), readmeFacts(es)), '');
});

test('R14: each README opens with its language selector', async () => {
  const [en, es] = await Promise.all([read('README.md'), read('README.es.md')]);
  assert.equal(readmeFacts(en).selector, '> [Español](README.es.md) · **English**');
  assert.equal(readmeFacts(es).selector, '> **Español** · [English](README.md)');
});
