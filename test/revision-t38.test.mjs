// T38 (spec 016, R38) — el linter del portón no mide LLAMADAS como si fueran funciones declaradas:
// `return join(a, b, c, d, e)` o `await equipForSpec(a, b, c, d, e)` daban `too-many-params` porque la
// palabra clave se tomaba por tipo de retorno. Las declaraciones reales siguen detectándose.

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../catalog/gate/lib/source.mjs';

const names = (src) => analyze(src.split('\n')).functions.map((f) => `${f.name}/${f.params}`);

test('R38: calls after return, await, yield, throw, new, typeof, else or case are not functions', () => {
  for (const kw of ['return', 'await', 'yield', 'throw', 'new', 'typeof', 'else', 'case', 'delete']) {
    assert.deepEqual(names(`  ${kw} join(a, b, c, d, e);`), [], kw);
  }
  assert.deepEqual(names('  return tracked(s, role, task, onStep, async (id, step) => {\n    x();\n  });'), []);
});

test('R38: a call statement is not a function (followed by ; , ) or .)', () => {
  assert.deepEqual(names('foo(a, b, c, d, e);'), []);
  assert.deepEqual(names('  build(\n    a,\n    b\n  );'), []);
  assert.deepEqual(names('  chain(a).then(b);'), []);
  assert.deepEqual(names('  list.push(item), other(x);'), []);
});

test('R38: real declarations are still detected, with and without a return type', () => {
  assert.deepEqual(names('export async function equipForSpec(proj, mode, target, lang, opts) {\n  x();\n}'), ['equipForSpec/5']);
  assert.deepEqual(names('function manifestBody(a, b, c, d, e) {\n}'), ['manifestBody/5']);
  assert.deepEqual(names('  Future<void> load(a, b) {\n  }'), ['load/2']);
  assert.deepEqual(names('  public static int Sum(int a, int b) {\n  }'), ['Sum/2']);
  assert.deepEqual(names('void main(a) {\n}'), ['main/1']);   // `void` es un tipo, no una expresión
  assert.deepEqual(names('const total = (a, b) => a + b;'), ['total/2']);
});

test('R38: calls inside an array literal and keyword expressions that continue after the call', () => {
  assert.deepEqual(names('  foo(a, b, c, d, e),'), []);
  for (const kw of ['return', 'await', 'yield', 'throw', 'new', 'typeof', 'else', 'case', 'delete']) {
    assert.deepEqual(names(`  ${kw} join(a, b, c, d, e) && done();`), [], kw);
  }
});
