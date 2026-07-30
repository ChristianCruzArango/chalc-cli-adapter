import test from 'node:test';
import assert from 'node:assert/strict';
import { contractRoutes, findDuplicateRoutes } from '../lib/contractlint.mjs';

const CONTRACT_A = `# Contrato: login
## Endpoints
- **POST** \`/api/auth/login\` — autentica
- **GET** \`/api/users/{id}\` — perfil

| Método | Ruta | Descripción |
|---|---|---|
| DELETE | /api/sessions/{id} | cierra sesión |
`;

// R7 — extrae pares MÉTODO /ruta de listas y tablas markdown, sin duplicar dentro del mismo contrato.
test('contractRoutes extracts method/path pairs from lists and tables', () => {
  const routes = contractRoutes(CONTRACT_A);
  assert.deepEqual(routes, [
    { method: 'POST', path: '/api/auth/login' },
    { method: 'GET', path: '/api/users/{id}' },
    { method: 'DELETE', path: '/api/sessions/{id}' }
  ]);
});

// R7 — la misma ruta repetida DENTRO de un contrato no cuenta doble (solo importa entre HUs).
test('contractRoutes dedupes repeats inside one contract', () => {
  const routes = contractRoutes('GET /a\n\nGET /a\nPOST /a');
  assert.deepEqual(routes, [{ method: 'GET', path: '/a' }, { method: 'POST', path: '/a' }]);
});

// R7 — la barra final no cuenta: '/a/' y '/a' son la misma ruta.
test('contractRoutes treats a trailing slash as the same route', () => {
  const routes = contractRoutes('GET /a/\nGET /a');
  assert.deepEqual(routes, [{ method: 'GET', path: '/a/' }]);
});

// R7 — duplicado = mismo método y ruta normalizada en HUs DISTINTAS; :id ≡ {id}.
test('findDuplicateRoutes flags the same route across different HUs, :id equals {id}', () => {
  const dups = findDuplicateRoutes([
    { id: '005-login', contract: 'GET /api/orders/:id\nPOST /api/orders' },
    { id: '006-reportes', contract: 'GET /api/orders/{id}\nGET /api/reports' },
    { id: '007-pagos', contract: 'POST /api/payments' }
  ]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].method, 'GET');
  assert.deepEqual(dups[0].ids, ['005-login', '006-reportes']);
});

// R7 — sin cruces: ninguna advertencia (mismo path con método distinto NO es duplicado).
test('findDuplicateRoutes returns empty when routes do not collide', () => {
  const dups = findDuplicateRoutes([
    { id: 'a', contract: 'GET /orders' },
    { id: 'b', contract: 'POST /orders' }
  ]);
  assert.deepEqual(dups, []);
});
