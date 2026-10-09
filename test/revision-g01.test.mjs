// G-01 (spec 016, R6) — una línea de CONTENIDO del diff que empieza por `+++` (añadir `++ counter;`)
// o `---` (borrar `-- x`) no se toma por cabecera de archivo: los hunks siguientes siguen siendo del
// archivo real y el portón los revisa.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHunks, removedByFile, touchesChange } from '../catalog/gate/lib/hunks.mjs';

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -5,0 +5,1 @@',
  '+++ counter;',
  '@@ -40,0 +41,3 @@',
  '+const apiKey = "sk-live-falsa";',
  '+const b = 2;',
  '+const c = 3;',
  ''
].join('\n');

test('R6: an added line starting with "++ " does not change the current file', () => {
  const byFile = parseHunks(DIFF);
  assert.deepEqual([...byFile.keys()], ['src/a.ts']);
  assert.deepEqual([...byFile.get('src/a.ts')], [5, 41, 42, 43]);
  assert.equal(touchesChange(byFile, 'src/a.ts', 41, 43), true);
});

test('R6: a removed line starting with "-- " and an added "+++" line keep removals attributed', () => {
  const diff = [
    'diff --git a/x.sql b/x.sql',
    '--- a/x.sql',
    '+++ b/x.sql',
    '@@ -3,2 +3,1 @@',
    '--- comentario sql',
    '-select 1;',
    '+++ otro',
    '@@ -10 +9,0 @@',
    '-borrada',
    ''
  ].join('\n');
  assert.deepEqual([...removedByFile(diff)], [['x.sql', 3]]);
  assert.deepEqual([...parseHunks(diff).get('x.sql')], [3]);
});

test('R6: context lines and "no newline" markers inside a hunk are not headers either', () => {
  const diff = [
    'diff --git a/a.md b/a.md',
    '--- a/a.md',
    '+++ b/a.md',
    '@@ -1,3 +1,4 @@',
    ' +++ texto de contexto',
    '-viejo',
    '+++ nuevo',
    '+otra',
    ' fin',
    '\\ No newline at end of file',
    '@@ -20,0 +21 @@',
    '+tarde',
    'diff --git a/b.md b/b.md',
    '--- a/b.md',
    '+++ b/b.md',
    '@@ -1 +1 @@',
    '-x',
    '+y',
    ''
  ].join('\n');
  const byFile = parseHunks(diff);
  assert.deepEqual([...byFile.keys()], ['a.md', 'b.md']);
  assert.deepEqual([...byFile.get('a.md')], [1, 2, 3, 4, 21]);
  assert.deepEqual([...byFile.get('b.md')], [1]);
  assert.deepEqual([...removedByFile(diff)], [['a.md', 3], ['b.md', 1]]);
});

test('R6: new and deleted files keep working (/dev/null headers)', () => {
  const diff = [
    'diff --git a/n.ts b/n.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/n.ts',
    '@@ -0,0 +1,2 @@',
    '+++ a;',
    '+b;',
    'diff --git a/d.ts b/d.ts',
    'deleted file mode 100644',
    '--- a/d.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-uno',
    '-dos',
    ''
  ].join('\n');
  const byFile = parseHunks(diff);
  assert.deepEqual([...byFile.keys()], ['n.ts']);
  assert.deepEqual([...byFile.get('n.ts')], [1, 2]);
  assert.deepEqual([...removedByFile(diff)], [['n.ts', 0]]);
});

test('R6: context lines count toward the hunk, so the next file header is still recognised', () => {
  const diff = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,2 +1,3 @@',
    ' contexto',
    '+nueva',
    ' contexto',
    'diff --git a/b.ts b/b.ts',
    '--- a/b.ts',
    '+++ b/b.ts',
    '@@ -4,0 +5 @@',
    '+b',
    ''
  ].join('\n');
  const byFile = parseHunks(diff);
  assert.deepEqual([...byFile.keys()], ['a.ts', 'b.ts']);
  assert.deepEqual([...byFile.get('b.ts')], [5]);
});
