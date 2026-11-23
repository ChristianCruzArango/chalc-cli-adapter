// Spec 042 (evals activos), T1 — las comprobaciones (R3, R4): deterministas, sin juez. Dicen si un archivo quedó
// intacto, si algo existe o no, si un contenido aparece, si un comando sale como debe y si la interfaz cumple.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { writeFiles } from './helpers/teamrepo.mjs';
import { CHECK_KINDS, runChecks } from '../catalog/evals/lib/checks.mjs';
import { compare, totalOf } from '../catalog/evals/lib/score.mjs';

const FIXTURE = { 'src/a.js': 'exports.a = 1;\n', 'test/a.test.js': 'const assert = require("assert");\n', 'README.md': 'hola\n' };
async function folder(t, files = FIXTURE) {
  const dir = await tempDir(t, 'chalc-042-checks-');
  await writeFiles(dir, files);
  return dir;
}
const one = async (dir, check, extra = {}) => (await runChecks({ dir, files: FIXTURE, checks: [{ id: 'c', points: 5, ...check }], ...extra }))[0];
const status = async (dir, check, extra) => (await one(dir, check, extra)).status;

test('R3: los tipos de comprobación', () => {
  assert.deepEqual([...CHECK_KINDS].sort(), ['absent', 'command', 'design', 'exists', 'matches', 'not-matches', 'unchanged']);
});

test('R3: `unchanged`: el archivo sigue como en el estado inicial; cambiarlo, o borrarlo, falla', async (t) => {
  const dir = await folder(t);
  assert.deepEqual(await one(dir, { kind: 'unchanged', files: ['test/a.test.js', 'README.md'] }), { id: 'c', kind: 'unchanged', points: 5, earned: 5, status: 'pass', detail: '' });
  await writeFile(join(dir, 'README.md'), 'hola\r\n');
  assert.equal(await status(dir, { kind: 'unchanged', files: ['README.md'] }), 'pass', 'los saltos de línea de Windows no son un cambio');
  await writeFile(join(dir, 'test', 'a.test.js'), '// test aflojado\n');
  assert.deepEqual(await one(dir, { kind: 'unchanged', files: ['README.md', 'test/a.test.js'] }), { id: 'c', kind: 'unchanged', points: 5, earned: 0, status: 'fail', detail: 'test/a.test.js' });
  assert.equal(await status(dir, { kind: 'unchanged', files: ['no/estaba.js'] }), 'fail', 'un archivo que no era del estado inicial no puede estar intacto');
});

test('R3: `exists` y `absent`', async (t) => {
  const dir = await folder(t);
  assert.deepEqual([await status(dir, { kind: 'exists', file: 'README.md' }), await status(dir, { kind: 'exists', file: 'BLOCKED.md' })], ['pass', 'fail']);
  assert.deepEqual([await status(dir, { kind: 'absent', file: 'BLOCKED.md' }), await status(dir, { kind: 'absent', file: 'README.md' })], ['pass', 'fail']);
  assert.equal(await status(dir, { kind: 'exists', file: '../fuera.txt' }), 'fail', 'nada fuera de la carpeta del caso');
});

test('R3: `matches` y `not-matches` sobre el contenido de un archivo', async (t) => {
  const dir = await folder(t);
  assert.equal(await status(dir, { kind: 'matches', file: 'src/a.js', pattern: 'exports\\.a\\s*=' }), 'pass');
  assert.equal(await status(dir, { kind: 'matches', file: 'src/a.js', pattern: 'https?://' }), 'fail');
  assert.equal(await status(dir, { kind: 'not-matches', file: 'src/a.js', pattern: 'https?://' }), 'pass');
  assert.equal(await status(dir, { kind: 'not-matches', file: 'src/a.js', pattern: 'EXPORTS', flags: 'i' }), 'fail');
  assert.equal(await status(dir, { kind: 'matches', file: 'no-existe.js', pattern: 'x' }), 'fail');
  assert.equal(await status(dir, { kind: 'not-matches', file: 'no-existe.js', pattern: 'x' }), 'fail', 'sin archivo no hay nada que dar por limpio');
});

test('R3: `command` corre en la carpeta y compara el código de salida, con plazo', async (t) => {
  const dir = await folder(t, { ...FIXTURE, 'ok.js': 'process.exit(0);\n', 'mal.js': 'process.exit(3);\n', 'lento.js': 'setTimeout(function fin() { process.exit(0); }, 1500);\n' });
  assert.equal(await status(dir, { kind: 'command', run: 'node ok.js' }), 'pass');
  assert.deepEqual(await one(dir, { kind: 'command', run: 'node mal.js' }), { id: 'c', kind: 'command', points: 5, earned: 0, status: 'fail', detail: 'exit 3' });
  assert.equal(await status(dir, { kind: 'command', run: 'node mal.js', exit: 3 }), 'pass');
  assert.deepEqual((await one(dir, { kind: 'command', run: 'node lento.js', timeoutMs: 300 })).detail, 'timeout');
});

test('R3, R4: `design` mide la página contra el contrato; sin navegador se omite', async (t) => {
  const dir = await folder(t, { 'index.html': '<button>x</button>' });
  const el = (selector, x) => ({ selector, interactive: true, visible: true, rect: { x, y: 16, width: 100, height: 44 }, fontSize: 16, color: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)', text: selector });
  const browser = (elements) => async () => ({ close: async () => {}, session: { once: async () => ({}), send: async (method) => ({ 'Target.createTarget': { targetId: 'T' }, 'Target.attachToTarget': { sessionId: 'S' }, 'Runtime.evaluate': { result: { value: elements } }, 'Page.captureScreenshot': { data: '' } }[method] || {}) } });
  const check = { kind: 'design', page: 'index.html' };
  assert.equal(await status(dir, check, { launch: browser([el('#a', 16), el('#b', 124)]) }), 'pass');
  const close = await one(dir, check, { launch: browser([el('#a', 16), el('#b', 118)]) });
  assert.deepEqual([close.status, close.earned, close.detail.includes('design-interactive-too-close')], ['fail', 0, true]);
  assert.deepEqual(await one(dir, check, { launch: async () => null }), { id: 'c', kind: 'design', points: 5, earned: 0, status: 'skipped', detail: 'no-browser' });
  assert.equal(await status(dir, { kind: 'design', page: 'no-existe.html' }, { launch: browser([]) }), 'fail');
});

test('R4: un tipo desconocido se omite; y el total no cuenta lo omitido', async (t) => {
  const dir = await folder(t);
  const results = await runChecks({ dir, files: FIXTURE, checks: [{ id: 'a', kind: 'exists', file: 'README.md', points: 6 }, { id: 'b', kind: 'exists', file: 'nada', points: 4 }, { id: 'c', kind: 'telepatía', points: 9 }] });
  assert.deepEqual(results.map((r) => [r.id, r.status, r.earned]), [['a', 'pass', 6], ['b', 'fail', 0], ['c', 'skipped', 0]]);
  assert.deepEqual(totalOf(results), { earned: 6, max: 10, percent: 60, skipped: 1 });
  assert.deepEqual(totalOf([]), { earned: 0, max: 0, percent: 0, skipped: 0 });
});

test('R5: comparar: por etiqueta y caso, cuántas corridas y su media', () => {
  const run = (label, id, percent) => ({ label, case: id, percent });
  const runs = [run('medio v1', 'a', 50), run('medio v1', 'a', 100), run('medio v1', 'b', 100), run('económico', 'a', 0), run('', 'a', 100)];
  assert.deepEqual(compare(runs), [
    { label: '', case: 'a', runs: 1, average: 100 }, { label: 'económico', case: 'a', runs: 1, average: 0 },
    { label: 'medio v1', case: 'a', runs: 2, average: 75 }, { label: 'medio v1', case: 'b', runs: 1, average: 100 }]);
  assert.deepEqual(compare([]), []);
});
