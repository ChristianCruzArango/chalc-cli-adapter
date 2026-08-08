// T20 (R8) — las rutas del contrato existen en el código del repo.
//
// El contrato es lo único que back, front y móvil comparten. Cuando uno de los tres se desincroniza,
// el error no aparece en sus tests —cada repo está verde— sino en integración, días después. Esta
// etapa lo hace visible en la tarea que lo rompió.
//
// La comprobación es DELIBERADAMENTE conservadora: solo reporta lo que con certeza no está. En un
// back de NestJS la ruta nunca aparece entera (`@Controller('carrito')` + `@Post(':id/items')`), así
// que exigir la ruta literal marcaría todo como ausente y la etapa se volvería ruido a los dos días.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { checkContract } from '../catalog/gate/lib/contractcheck.mjs';
import { contractRoutesWithLines } from '../lib/contractlint.mjs';

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-contract-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

// El portón recibe el extractor ya cargado: en el repo equipado es la copia de `contractlint.mjs`.
// Aquí se le pasa la fuente real, que es la misma función.
const check = (root, over = {}) => checkContract({ root, routesOf: contractRoutesWithLines, ...over });

const CONTRACT = [
  '# Contrato — carrito',
  '',
  '| Método | Ruta | Descripción |',
  '|---|---|---|',
  '| GET | `/api/carrito/{id}` | Trae el carrito |',
  '| POST | `/api/carrito/{id}/items` | Agrega un ítem |'
].join('\n');

const CONTROLLER = "@Controller('carrito')\nexport class CarritoController {}\n";

test('checkContract reports a contract route missing from the code', async () => {
  const dir = await project({
    'specs/007-carrito/contracts/api.md': CONTRACT,
    'src/carrito.controller.ts': CONTROLLER
  });

  const findings = await check(dir);

  assert.equal(findings.length, 1, 'la ruta del GET sí está: "carrito" aparece en el controlador');
  assert.equal(findings[0].rule, 'contract-route-missing');
  assert.equal(findings[0].line, 6, 'se señala la línea del contrato, que es el artefacto compartido');
  assert.equal(findings[0].data.method, 'POST');
  assert.equal(findings[0].data.path, '/api/carrito/{id}/items');
  assert.deepEqual(findings[0].data.missing, ['items']);
});

// Caso que decide si esta etapa sirve: la ruta troceada en decoradores NO puede dar falso positivo.
test('checkContract accepts a route split across routing decorators', async () => {
  const dir = await project({
    'specs/007-carrito/contracts/api.md': CONTRACT,
    'src/carrito.controller.ts': `${CONTROLLER}\n@Post(':id/items')\naddItem() {}\n`
  });

  assert.deepEqual(await check(dir), []);
});

test('checkContract does not demand path parameters literally', async () => {
  const dir = await project({
    'specs/007-carrito/contracts/api.md': '| GET | `/api/carrito/:id` |',
    'src/carrito.service.ts': "const url = '/carrito/' + id;\n"
  });

  assert.deepEqual(await check(dir), []);
});

// `api`, `v1` y compañía están en todas las rutas y en ninguna implementación: exigirlos reportaría
// el contrato entero como ausente.
test('checkContract ignores generic path segments', async () => {
  const dir = await project({
    'specs/007-carrito/contracts/api.md': '| GET | `/api/v1/health` |',
    'src/health.controller.ts': "@Get('health')\nping() {}\n"
  });

  assert.deepEqual(await check(dir), []);
});

// El contrato y el README mencionan la ruta por definición: si contaran como implementación, la
// etapa se aprobaría a sí misma.
test('checkContract does not accept prose as an implementation', async () => {
  const dir = await project({
    'specs/007-carrito/contracts/api.md': CONTRACT,
    'README.md': 'El back expone /api/carrito/{id}/items para agregar ítems.\n'
  });

  const findings = await check(dir);

  assert.equal(findings.length, 2, 'ni "carrito" ni "items" están en código');
});

// El papel viaja como dato; la redacción ("no la expone" vs "no la consume") la elige el marco
// bilingüe, y su test vive en `gate-i18n.test.mjs`.
test('checkContract carries the role of the repo in the finding', async () => {
  const dir = await project({ 'specs/007-carrito/contracts/api.md': CONTRACT });

  const back = await check(dir, { role: 'back' });
  const front = await check(dir, { role: 'front' });

  assert.equal(back[0].data.role, 'back');
  assert.equal(front[0].data.role, 'front');
});

// R8 es condicional (WHERE el repo tiene contrato): sin contrato no hay nada que comprobar.
test('checkContract stays quiet when the repo has no contract', async () => {
  const dir = await project({ 'specs/007-carrito/spec.md': '- **R1** — algo.' });

  assert.deepEqual(await check(dir), []);
});

test('checkContract uses the contract of the newest spec', async () => {
  const dir = await project({
    'specs/006-viejo/contracts/api.md': '| GET | `/api/legacy/ping` |',
    'specs/007-carrito/contracts/api.md': '| GET | `/api/carrito/{id}` |',
    'src/carrito.controller.ts': CONTROLLER
  });

  assert.deepEqual(await check(dir), []);
});
