// Spec 033 (worktrees y olas), T2 — el reparto en olas (R3, R4, R5): dos specs que tocan lo mismo nunca van a la
// vez, y una spec va después de aquellas de las que depende.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wavesOf } from '../catalog/team/lib/waves.mjs';

const spec = (name, touches, dependsOn = []) => ({ spec: `specs/${name}`, touches, dependsOn });
const names = (out) => out.waves.map((wave) => wave.map((s) => s.slice(6)));

test('R3: specs que no se tocan van juntas en la primera ola', () => {
  const out = wavesOf([spec('027-a', ['src/a/**']), spec('028-b', ['src/b/**']), spec('029-c', ['src/c.ts'])]);
  assert.deepEqual(out, { waves: [['specs/027-a', 'specs/028-b', 'specs/029-c']], problem: '', spec: '' });
});

test('R3: dos que se solapan nunca comparten ola; la primera en la lista va antes', () => {
  assert.deepEqual(names(wavesOf([spec('027-a', ['src/pagos/**']), spec('028-b', ['src/pagos/total.ts']), spec('029-c', ['src/c/**'])])), [['027-a', '029-c'], ['028-b']]);
  // Tres que chocan entre sí: una por ola.
  assert.deepEqual(names(wavesOf([spec('1-a', ['src/**']), spec('2-b', ['src/x/**']), spec('3-c', ['src/x/y.ts'])])), [['1-a'], ['2-b'], ['3-c']]);
});

test('R3: una spec va después de TODAS las specs de las que depende, aunque no se toquen', () => {
  const out = wavesOf([spec('030-c', ['src/c/**'], ['027-a', '029-b']), spec('027-a', ['src/a/**']), spec('029-b', ['src/b/**'], ['027-a'])]);
  assert.deepEqual(names(out), [['027-a'], ['029-b'], ['030-c']]);
});

test('R4: una spec sin `Toca:` va sola en su ola', () => {
  assert.deepEqual(names(wavesOf([spec('027-a', ['src/a/**']), spec('028-b', []), spec('029-c', ['src/c/**'])])), [['027-a', '029-c'], ['028-b']]);
  assert.deepEqual(names(wavesOf([spec('027-a', []), spec('028-b', [])])), [['027-a'], ['028-b']]);
  assert.deepEqual(names(wavesOf([spec('027-a', [])])), [['027-a']], 'con una sola spec no hay con quién chocar');
});

test('R5: depender de una spec que no es de la feature se rechaza, diciendo cuál', () => {
  assert.deepEqual(wavesOf([spec('027-a', ['a'], ['099-otra'])]), { waves: [], problem: 'unknown-dependency', spec: 'specs/027-a' });
});

test('R5: un ciclo de dependencias se rechaza; depender de sí misma también', () => {
  assert.deepEqual(wavesOf([spec('027-a', ['a'], ['028-b']), spec('028-b', ['b'], ['027-a'])]), { waves: [], problem: 'dependency-cycle', spec: 'specs/027-a' });
  assert.equal(wavesOf([spec('027-a', ['a'], ['027-a'])]).problem, 'dependency-cycle');
});

test('sin specs no hay olas ni problema', () => {
  assert.deepEqual(wavesOf([]), { waves: [], problem: '', spec: '' });
});
