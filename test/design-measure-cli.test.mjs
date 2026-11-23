// Spec 039 (medición en navegador), T4 — `node .chalc/design.mjs measure` (R2, R3, R4): mide, guarda medidas y
// capturas, evalúa contra el contrato, y distingue «hay hallazgos» de «no se pudo medir». Aquí el navegador se
// inyecta; la prueba con uno real es `design-real-browser.test.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { writeFiles } from './helpers/teamrepo.mjs';
import { main } from '../catalog/design/design.mjs';
import { MESSAGES } from '../catalog/design/lib/i18n.mjs';
import { LOCAL_IGNORES } from '../lib/gitignore-local.mjs';

const T = MESSAGES.es;
const el = (selector, x) => ({ selector, interactive: true, primary: false, visible: true, rect: { x, y: 16, width: 100, height: 44 }, fontSize: 16, bold: false, color: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)', text: selector });
const CLOSE = [el('#guardar', 16), el('#cancelar', 118)];
const FINE = [el('#guardar', 16), el('#cancelar', 124)];
// Un navegador de mentira que devuelve `elements` en cada vista.
function browser(elements, { fail = '' } = {}) {
  const state = { launched: 0, closed: 0 };
  const results = { 'Target.createTarget': { targetId: 'T' }, 'Target.attachToTarget': { sessionId: 'S' }, 'Page.navigate': fail ? { errorText: fail } : {}, 'Runtime.evaluate': { result: { value: elements } }, 'Page.captureScreenshot': { data: Buffer.from('PNG').toString('base64') } };
  const launch = async () => { state.launched += 1; return { session: { send: async (method) => results[method] || {}, once: async () => ({}) }, close: async () => { state.closed += 1; } }; };
  return { state, launch };
}
async function project(t, files = {}) {
  const root = await tempDir(t, 'chalc-039-cli-');
  await writeFiles(root, { '.chalc/gate.json': JSON.stringify({ language: 'es' }), ...files });
  return root;
}
const run = async (root, launch, ...args) => { const lines = []; return { code: await main({ argv: ['node', 'design.mjs', ...args], cwd: root, write: (l) => lines.push(l), launch }), text: lines.join('\n') }; };
const URL_OK = 'http://localhost:3000/pago';

test('R2: mide, guarda las medidas y una captura por vista, y con hallazgos sale con 1', async (t) => {
  const root = await project(t);
  const { state, launch } = browser(CLOSE);
  const out = await run(root, launch, 'measure', URL_OK);
  assert.equal(out.code, 1, out.text);
  assert.ok(out.text.includes('#guardar') && out.text.includes('2 px'));
  const saved = JSON.parse(await readFile(join(root, '.chalc', 'design-out', 'measurements.json'), 'utf8'));
  assert.deepEqual(saved.viewports.map((v) => [v.name, v.url, v.screenshot, v.elements.length]), [['movil', URL_OK, 'movil.png', 2], ['tablet', URL_OK, 'tablet.png', 2], ['escritorio', URL_OK, 'escritorio.png', 2]]);
  for (const name of ['movil.png', 'tablet.png', 'escritorio.png']) assert.equal(await readFile(join(root, '.chalc', 'design-out', name), 'utf8'), 'PNG', name);
  assert.deepEqual([state.launched, state.closed], [1, 1], 'el navegador se cierra siempre');
  assert.ok(out.text.includes(T.savedIn('.chalc/design-out')));
});

test('R2: sin hallazgos sale con 0; y las capturas quedan fuera de git', async (t) => {
  const root = await project(t);
  const out = await run(root, browser(FINE).launch, 'measure', URL_OK);
  assert.equal(out.code, 0, out.text);
  assert.ok(out.text.includes(T.clean));
  assert.ok(LOCAL_IGNORES.includes('.chalc/design-out/'));
});

test('R2: con varias URL cada captura tiene su nombre, y --spec usa el contrato y las vistas de esa carpeta', async (t) => {
  const root = await project(t, { 'specs/027-x/design.contract.json': JSON.stringify({ viewports: [{ name: 'movil', width: 375, height: 812 }], spacing: { minGap: 2, enforceScale: false } }) });
  const out = await run(root, browser(CLOSE).launch, 'measure', 'http://localhost/a', 'http://localhost/b?x=1', '--spec', 'specs/027-x');
  assert.equal(out.code, 0, out.text);
  const saved = JSON.parse(await readFile(join(root, '.chalc', 'design-out', 'measurements.json'), 'utf8'));
  assert.deepEqual(saved.viewports.map((v) => v.screenshot), ['movil-http-localhost-a.png', 'movil-http-localhost-b-x-1.png']);
  for (const v of saved.viewports) assert.ok(existsSync(join(root, '.chalc', 'design-out', v.screenshot)));
});

test('R3: sin navegador no se mide, y el código no es el de «hay hallazgos»', async (t) => {
  const root = await project(t);
  const out = await run(root, async () => null, 'measure', URL_OK);
  assert.deepEqual([out.code, out.text], [2, T.noBrowser]);
  assert.equal(existsSync(join(root, '.chalc', 'design-out')), false);
});

test('R4: una URL que no es local se rechaza sin abrir el navegador, salvo con --allow-remote', async (t) => {
  const root = await project(t);
  const { state, launch } = browser(FINE);
  const refused = await run(root, launch, 'measure', URL_OK, 'https://example.com/x');
  assert.deepEqual([refused.code, refused.text, state.launched], [2, T.notLocal('https://example.com/x'), 0]);
  assert.equal((await run(root, launch, 'measure', 'https://example.com/x', '--allow-remote')).code, 0);
});

test('R5: si la página no carga se dice cuál, sale con 2 y el navegador se cierra igual', async (t) => {
  const root = await project(t);
  const { state, launch } = browser(FINE, { fail: 'net::ERR_CONNECTION_REFUSED' });
  const out = await run(root, launch, 'measure', URL_OK);
  assert.equal(out.code, 2);
  assert.ok(out.text.includes(URL_OK) && out.text.includes('ERR_CONNECTION_REFUSED'));
  assert.deepEqual([state.launched, state.closed], [1, 1]);
});

test('R1: sin URL, el uso', async (t) => {
  const out = await run(await project(t), browser(FINE).launch, 'measure');
  assert.deepEqual([out.code, out.text], [1, T.usage]);
  assert.ok(T.usage.includes('measure') && MESSAGES.en.usage.includes('measure'));
});
