// Spec 039 (medición en navegador), T1 — encontrar el navegador del sistema (R3): Chrome, Edge o Chromium, o el
// que nombre CHALC_BROWSER. Sin ninguno no hay medición: no se inventa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserCandidates, findBrowser } from '../catalog/design/lib/browser.mjs';
import { envValue } from './helpers/envkey.mjs';

test('R3: en macOS, Chrome, Edge y Chromium en /Applications', () => {
  assert.deepEqual(browserCandidates('darwin', {}), [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ]);
});

test('R3: en Linux, los binarios habituales', () => {
  const found = browserCandidates('linux', {});
  for (const path of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']) assert.ok(found.includes(path), path);
});

test('R3: en Windows, bajo cada carpeta de programas que el entorno declare, sin distinguir mayúsculas en las variables', () => {
  const found = browserCandidates('win32', { ProgramFiles: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LocalAppData: 'C:\\Users\\u\\AppData\\Local' });
  assert.equal(found.length, 6);
  assert.ok(found.some((p) => p.startsWith('C:\\Program Files') && p.endsWith('chrome.exe')));
  assert.ok(found.some((p) => p.includes('(x86)') && p.endsWith('msedge.exe')));
  assert.ok(found.some((p) => p.includes('AppData') && p.endsWith('chrome.exe')));
  assert.deepEqual(browserCandidates('win32', {}), [], 'sin esas variables no hay dónde buscar');
});

test('R3: CHALC_BROWSER manda, y un sistema desconocido no tiene candidatos propios', () => {
  assert.deepEqual(browserCandidates('darwin', { CHALC_BROWSER: '/opt/mi-chrome' })[0], '/opt/mi-chrome');
  assert.deepEqual(browserCandidates('win32', { chalc_browser: 'D:\\chrome.exe' })[0], 'D:\\chrome.exe');
  assert.deepEqual(browserCandidates('aix', {}), []);
  assert.deepEqual(browserCandidates('aix', { CHALC_BROWSER: '  ' }), []);
});

test('R3: el navegador es el primer candidato que existe; si ninguno, cadena vacía', () => {
  const exists = (path) => path.includes('Edge');
  assert.equal(findBrowser({ platform: 'darwin', env: {}, exists }), '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  assert.equal(findBrowser({ platform: 'darwin', env: {}, exists: () => false }), '');
  assert.equal(findBrowser({ platform: 'darwin', env: { CHALC_BROWSER: '/no/existe' }, exists: () => false }), '', 'un CHALC_BROWSER que no existe no se da por bueno');
  assert.equal(typeof findBrowser(), 'string');
  assert.equal(typeof envValue(process.env, 'PATH'), 'string');
});
