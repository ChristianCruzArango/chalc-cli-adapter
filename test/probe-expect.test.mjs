// Spec 041 (superficies sin interfaz), T1 — qué se espera de una sonda (R2, R3): el archivo de sondas se lee con
// cuidado, y lo que llega se compara con lo esperado diciendo exactamente en qué difiere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbes } from '../catalog/probe/lib/probes.mjs';
import { apiMismatches, cliMismatches } from '../catalog/probe/lib/expect.mjs';

const json = (value) => JSON.stringify(value);

test('R1: un archivo de sondas bien formado', () => {
  const out = parseProbes(json({
    api: [{ name: 'crear pago', method: 'post', url: 'http://localhost:3000/pagos', headers: { 'content-type': 'application/json' }, body: { monto: 10 }, expect: { status: 201, json: { estado: 'creado' } } }, { name: 'salud', url: 'http://localhost:3000/salud', expect: { status: 200 } }],
    cli: [{ name: 'ayuda', command: 'node bin/x.js --help', expect: { exit: 0, stdout: 'Uso' } }]
  }));
  assert.equal(out.problem, '');
  assert.deepEqual(out.api.map((p) => [p.name, p.method, p.url]), [['crear pago', 'POST', 'http://localhost:3000/pagos'], ['salud', 'GET', 'http://localhost:3000/salud']]);
  assert.deepEqual(out.api[0].body, { monto: 10 });
  assert.deepEqual(out.cli, [{ name: 'ayuda', command: 'node bin/x.js --help', expect: { exit: 0, stdout: 'Uso' } }]);
});

test('R4: lo que no es un archivo de sondas se dice con su porqué, y no se ejecuta nada', () => {
  const cases = [['{ roto', 'not-json'], ['[]', 'not-object'], ['{}', 'empty'], [json({ api: [], cli: [] }), 'empty'], [json({ api: 'x' }), 'not-object'],
    [json({ api: [{ url: 'http://localhost/x', expect: { status: 200 } }] }), 'no-name'], [json({ api: [{ name: 'a', expect: { status: 200 } }] }), 'no-url:a'],
    [json({ api: [{ name: 'a', url: 'http://localhost/x' }] }), 'no-expect:a'], [json({ api: [{ name: 'a', url: 'http://localhost/x', expect: {} }] }), 'no-expect:a'],
    [json({ cli: [{ name: 'c', expect: { exit: 0 } }] }), 'no-command:c'], [json({ cli: [{ name: 'c', command: 'x' }] }), 'no-expect:c'],
    [json({ api: [{ name: 'a', url: 'http://localhost/x', expect: { status: 200 } }, { name: 'a', url: 'http://localhost/y', expect: { status: 200 } }] }), 'duplicate:a'], [null, 'not-json']];
  for (const [text, problem] of cases) assert.deepEqual(parseProbes(text), { api: [], cli: [], problem }, String(text));
});

test('R2: el estado, un subconjunto del JSON y el texto que debe contener', () => {
  const response = { status: 201, body: json({ id: 'p_1', estado: 'creado', cliente: { nombre: 'Ana', edad: 30 }, items: [{ sku: 'a', n: 1 }, { sku: 'b', n: 2 }] }) };
  assert.deepEqual(apiMismatches({ status: 201, json: { estado: 'creado', id: '*', cliente: { nombre: 'Ana' }, items: [{ sku: 'a' }] }, contains: 'p_1' }, response), []);
  assert.deepEqual(apiMismatches({ status: 200 }, response), [{ what: 'status', expected: 200, actual: 201 }]);
  assert.deepEqual(apiMismatches({ json: { estado: 'pagado' } }, response), [{ what: 'json.estado', expected: 'pagado', actual: 'creado' }]);
  assert.deepEqual(apiMismatches({ json: { cliente: { nombre: 'Luis', pais: '*' } } }, response), [{ what: 'json.cliente.nombre', expected: 'Luis', actual: 'Ana' }, { what: 'json.cliente.pais', expected: '*', actual: undefined }]);
  assert.deepEqual(apiMismatches({ json: { items: [{ sku: 'a' }, { sku: 'c' }] } }, response), [{ what: 'json.items.1.sku', expected: 'c', actual: 'b' }]);
  assert.deepEqual(apiMismatches({ contains: ['creado', 'no-está'] }, response), [{ what: 'contains', expected: 'no-está', actual: '' }]);
});

test('R2: los tipos cuentan, null es un valor, y una respuesta que no es JSON no cumple un JSON esperado', () => {
  assert.deepEqual(apiMismatches({ json: { n: 1 } }, { status: 200, body: json({ n: '1' }) }), [{ what: 'json.n', expected: 1, actual: '1' }]);
  assert.deepEqual(apiMismatches({ json: { fin: null, ok: false, n: 0 } }, { status: 200, body: json({ fin: null, ok: false, n: 0 }) }), []);
  assert.deepEqual(apiMismatches({ json: { fin: '*' } }, { status: 200, body: json({ fin: null }) }), [], 'presente aunque sea null');
  assert.deepEqual(apiMismatches({ json: { a: 1 } }, { status: 200, body: '<html>' }), [{ what: 'json', expected: 'JSON', actual: '<html>' }]);
  assert.deepEqual(apiMismatches({ json: { a: { b: 1 } } }, { status: 200, body: json({ a: 'texto' }) }), [{ what: 'json.a.b', expected: 1, actual: undefined }]);
});

test('R3: el código de salida y los textos de cada salida', () => {
  const result = { exit: 0, stdout: 'Uso: x [opciones]\n  --help', stderr: '' };
  assert.deepEqual(cliMismatches({ exit: 0, stdout: ['Uso', '--help'] }, result), []);
  assert.deepEqual(cliMismatches({ exit: 2 }, result), [{ what: 'exit', expected: 2, actual: 0 }]);
  assert.deepEqual(cliMismatches({ stdout: 'Versión', stderr: 'aviso' }, result), [{ what: 'stdout', expected: 'Versión', actual: 'Uso: x [opciones]\n  --help' }, { what: 'stderr', expected: 'aviso', actual: '' }]);
  assert.deepEqual(cliMismatches({ exit: 1, stderr: 'falta' }, { exit: 1, stdout: '', stderr: 'error: falta el archivo' }), []);
});
