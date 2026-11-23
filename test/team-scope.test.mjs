// Spec 033 (worktrees y olas), T1 — lo que el plan declara que la spec toca (R1): se lee de `plan.md`, y de ahí
// salen el solape entre specs y la comprobación de que una entrega se quedó en su alcance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inScope, overlaps, planScope } from '../catalog/team/lib/scope.mjs';

test('R1: `Toca:` y `Depende de:` en una línea, separados por comas', () => {
  assert.deepEqual(planScope('# Plan\n\nToca: src/pagos/**, test/pagos/**\nDepende de: 027-checkout, specs/028-recibos\n'),
    { touches: ['src/pagos/**', 'test/pagos/**'], dependsOn: ['027-checkout', '028-recibos'] });
});

test('R1: como viñetas debajo, con o sin comillas invertidas, hasta la primera línea que no es viñeta', () => {
  const plan = ['# Plan', '', '**Toca:**', '- `src/pagos/total.ts`', '- test/pagos/ — los tests', '', '* src\\envios\\', 'Otra cosa', '- no/cuenta', '', 'Depende de:', '- `027-checkout`'].join('\n');
  assert.deepEqual(planScope(plan), { touches: ['src/pagos/total.ts', 'test/pagos', 'src/envios'], dependsOn: ['027-checkout'] });
});

test('R1: en inglés, y sin distinguir mayúsculas', () => {
  assert.deepEqual(planScope('touches: ./lib/a.mjs\nDEPENDS ON: 030-x\n'), { touches: ['lib/a.mjs'], dependsOn: ['030-x'] });
});

test('R1: sin declarar nada, las dos listas están vacías; «ninguna» no es una dependencia', () => {
  assert.deepEqual(planScope('# Plan\n\nEl cómo.\n'), { touches: [], dependsOn: [] });
  assert.deepEqual(planScope(null), { touches: [], dependsOn: [] });
  assert.deepEqual(planScope('Toca: src/a.ts\nDepende de: ninguna\n').dependsOn, []);
  assert.deepEqual(planScope('Touches: src/a.ts\nDepends on: none\n').dependsOn, []);
  assert.deepEqual(planScope('Toca: <rutas o globs>\n').touches, [], 'el hueco de la plantilla no es una ruta');
});

test('R1: una palabra que solo contiene «toca» no es la lista', () => {
  assert.deepEqual(planScope('Esto no toca: nada\nRetoca: src/a.ts\n').touches, []);
});

test('R3: dos patrones se solapan si el prefijo fijo de uno contiene al del otro', () => {
  const yes = [['src/pagos/**', 'src/pagos/total.ts'], ['src/pagos', 'src/pagos/total.ts'], ['src/**', 'src/pagos/**'], ['**', 'lo/que/sea.ts'], ['src/*.ts', 'src/a.ts'], ['src/a.ts', 'src/a.ts'], ['*.md', 'README.md']];
  const no = [['src/pagos/**', 'src/envios/**'], ['src/pagos', 'src/pagos-v2/a.ts'], ['src/a.ts', 'src/b.ts'], ['test/pagos/**', 'src/pagos/**']];
  for (const [a, b] of yes) { assert.equal(overlaps(a, b), true, `${a} ~ ${b}`); assert.equal(overlaps(b, a), true, `${b} ~ ${a}`); }
  for (const [a, b] of no) { assert.equal(overlaps(a, b), false, `${a} ~ ${b}`); assert.equal(overlaps(b, a), false, `${b} ~ ${a}`); }
});

test('R9: un archivo está en el alcance si algún patrón lo cubre', () => {
  const patterns = ['src/pagos/**', 'test/pagos', 'docs/*.md', 'package.json'];
  for (const file of ['src/pagos/total.ts', 'src/pagos/a/b/c.ts', 'test/pagos/total.test.ts', 'docs/pagos.md', 'package.json', 'src\\pagos\\win.ts']) assert.equal(inScope(file, patterns), true, file);
  for (const file of ['src/envios/a.ts', 'src/pagos.ts', 'test/pagos-v2/a.ts', 'docs/a/b.md', 'docs/pagos.mdx', 'package.json.bak', 'xsrc/pagos/a.ts']) assert.equal(inScope(file, patterns), false, file);
  assert.equal(inScope('lo/que/sea', []), false);
  assert.equal(inScope('a.b', ['a+b']), false, 'los caracteres del patrón son literales, no una expresión regular');
});
