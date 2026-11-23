// Spec 039 (medición en navegador), T5 — de punta a punta con un navegador de verdad (R1). Es OPCIONAL: solo
// corre con CHALC_BROWSER_TESTS=1 y un Chrome, Edge o Chromium instalado, porque CI no garantiza un navegador
// lanzable en los tres sistemas. Lo que mide: que la página real con dos botones a 2 px da ese hallazgo exacto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { writeFiles } from './helpers/teamrepo.mjs';
import { main } from '../catalog/design/design.mjs';
import { findBrowser } from '../catalog/design/lib/browser.mjs';
import { envValue } from './helpers/envkey.mjs';

const enabled = envValue(process.env, 'CHALC_BROWSER_TESTS') === '1' && Boolean(findBrowser());
const PAGE = (gap) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 16px; background: #fff; font: 16px sans-serif; }
  .fila { display: flex; gap: ${gap}px; }
  button { width: 100px; height: 44px; border: 0; padding: 0; color: #fff; background: #0a4fb0; font-size: 16px; }
</style></head><body><div class="fila"><button id="guardar" type="submit">Guardar</button><button id="cancelar">Cancelar</button></div></body></html>`;

async function serving(html) {
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, stop: () => { server.close(); server.closeAllConnections?.(); } };
}
async function measure(t, gap) {
  const root = await tempDir(t, 'chalc-039-real-');
  await writeFiles(root, { '.chalc/gate.json': JSON.stringify({ language: 'es' }) });
  const page = await serving(PAGE(gap));
  const lines = [];
  try {
    const code = await main({ argv: ['node', 'design.mjs', 'measure', page.url], cwd: root, write: (line) => lines.push(line) });
    return { root, code, text: lines.join('\n') };
  } finally { page.stop(); }
}

test('R1: dos botones a 2 px en una página real: hallazgo exacto en las tres vistas, con sus capturas', { skip: !enabled }, async (t) => {
  const { root, code, text } = await measure(t, 2);
  assert.equal(code, 1, text);
  for (const view of ['movil', 'tablet', 'escritorio']) assert.ok(text.includes(`[${view}] «#guardar» está a 2 px de «#cancelar»`), `${view}\n${text}`);
  const saved = JSON.parse(await readFile(join(root, '.chalc', 'design-out', 'measurements.json'), 'utf8'));
  const button = saved.viewports[0].elements.find((e) => e.selector === '#guardar');
  assert.deepEqual([button.rect.width, button.rect.height, button.primary, button.interactive, button.background, button.text], [100, 44, true, true, 'rgb(10, 79, 176)', 'Guardar']);
  const png = await readFile(join(root, '.chalc', 'design-out', 'movil.png'));
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'la captura es un PNG de verdad');
});

test('R1: la misma página con 8 px de separación cumple el contrato', { skip: !enabled }, async (t) => {
  const { code, text } = await measure(t, 8);
  assert.equal(code, 0, text);
});
