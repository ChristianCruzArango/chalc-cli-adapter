// Spec 039 (medición en navegador), T3 — tomar las medidas (R1, R4, R5): la sonda corre EN la página y devuelve
// lo que de verdad se pinta; el medidor recorre cada URL en cada ancho. Aquí, con un DOM y un navegador de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROBE } from '../catalog/design/lib/probe.mjs';
import { localOnly, measurePages } from '../catalog/design/lib/measure.mjs';

// ── un DOM mínimo ─────────────────────────────────────────────────────────────────────────────────
function node(tag, { id = '', attrs = {}, rect = [0, 0, 100, 44], style = {}, text = '', children = [] } = {}) {
  const el = {
    tagName: tag.toUpperCase(), id, parentElement: null, children, disabled: false, value: attrs.value || '',
    childNodes: [...(text ? [{ nodeType: 3, textContent: text }] : []), ...children],
    getAttribute: (name) => (name in attrs ? attrs[name] : null), hasAttribute: (name) => name in attrs,
    getBoundingClientRect: () => ({ x: rect[0], y: rect[1], width: rect[2], height: rect[3] }),
    style: { fontSize: '16px', fontWeight: '400', color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', display: 'block', visibility: 'visible', opacity: '1', ...style }
  };
  for (const child of children) child.parentElement = el;
  return el;
}
const flat = (el) => [el, ...el.children.flatMap(flat)];
function run(body) {
  const document = { body: { querySelectorAll: () => body.children.flatMap(flat) } };
  return new Function('document', 'getComputedStyle', `return ${PROBE}`)(document, (el) => el.style);
}
const bySelector = (elements) => Object.fromEntries(elements.map((e) => [e.selector, e]));

test('R1: la sonda es una expresión que se puede evaluar en la página', () => {
  assert.equal(typeof PROBE, 'string');
  assert.doesNotThrow(() => new Function(`return ${PROBE.replace(/\)\(\)\s*$/, ')')}`));
});

test('R1: de cada elemento, su caja, su letra, sus colores y qué es', () => {
  const body = node('body', { style: { backgroundColor: 'rgb(255, 255, 255)' }, children: [
    node('button', { id: 'guardar', attrs: { type: 'submit' }, rect: [16, 16, 100, 44], style: { fontSize: '14px', fontWeight: '700', color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(0, 90, 200)' }, text: ' Guardar ' }),
    node('p', { rect: [16, 80, 300, 20], text: 'Un párrafo' })
  ] });
  const found = bySelector(run(body));
  assert.deepEqual(found['#guardar'], { selector: '#guardar', interactive: true, primary: true, visible: true, rect: { x: 16, y: 16, width: 100, height: 44 }, fontSize: 14, bold: true, color: 'rgb(255, 255, 255)', background: 'rgb(0, 90, 200)', text: 'Guardar' });
  const p = Object.values(found).find((e) => e.text === 'Un párrafo');
  assert.deepEqual([p.interactive, p.primary, p.bold, p.fontSize], [false, false, false, 16]);
});

test('R1: el fondo es el efectivo: el del primer ancestro que no es transparente, o blanco', () => {
  const inner = node('a', { id: 'enlace', attrs: { href: '/x' }, text: 'ir' });
  const body = node('body', { children: [node('div', { style: { backgroundColor: 'rgb(10, 20, 30)' }, children: [node('span', { style: { backgroundColor: 'transparent' }, children: [inner] })] }), node('button', { id: 'solo', text: 'x' })] });
  const found = bySelector(run(body));
  assert.equal(found['#enlace'].background, 'rgb(10, 20, 30)');
  assert.equal(found['#solo'].background, 'rgb(255, 255, 255)');
});

test('R1: qué cuenta como interactivo y qué como primario', () => {
  const kinds = [
    ['a-href', node('a', { id: 'a-href', attrs: { href: '#' }, text: 'x' }), true, false],
    ['a-sin', node('a', { id: 'a-sin', text: 'x' }), false, false],
    ['rol', node('div', { id: 'rol', attrs: { role: 'button' }, text: 'x' }), true, false],
    ['tab', node('div', { id: 'tab', attrs: { tabindex: '0' }, text: 'x' }), true, false],
    ['tab-neg', node('div', { id: 'tab-neg', attrs: { tabindex: '-1' }, text: 'x' }), false, false],
    ['oculto', node('input', { id: 'oculto', attrs: { type: 'hidden' } }), false, false],
    ['campo', node('input', { id: 'campo', attrs: { type: 'text', placeholder: 'Correo' } }), true, false],
    ['marcado', node('button', { id: 'marcado', attrs: { 'data-primary': '' }, text: 'x' }), true, true],
    ['clase', node('button', { id: 'clase', attrs: { class: 'btn btn-primary grande' }, text: 'x' }), true, true],
    ['casi', node('button', { id: 'casi', attrs: { class: 'primary-outline' }, text: 'x' }), true, false]
  ];
  const found = bySelector(run(node('body', { children: kinds.map(([, el]) => el) })));
  for (const [id, , interactive, primary] of kinds) {
    if (id === 'oculto') { assert.equal(found['#oculto'], undefined, 'un campo oculto no se mide'); continue; }
    assert.deepEqual([found[`#${id}`].interactive, found[`#${id}`].primary], [interactive, primary], id);
  }
  assert.equal(found['#campo'].text, 'Correo', 'un campo se nombra por su marcador');
});

test('R1: lo que no se ve se marca; lo que no es interactivo ni tiene texto propio no se devuelve', () => {
  const body = node('body', { children: [
    node('button', { id: 'nada', style: { display: 'none' }, text: 'x' }), node('button', { id: 'invisible', style: { visibility: 'hidden' }, text: 'x' }),
    node('button', { id: 'cero', rect: [0, 0, 0, 0], text: 'x' }), node('button', { id: 'opaco0', style: { opacity: '0' }, text: 'x' }),
    node('div', { id: 'caja', children: [node('span', { id: 'texto', text: 'hola' })] })
  ] });
  const found = bySelector(run(body));
  for (const id of ['nada', 'invisible', 'cero', 'opaco0']) assert.equal(found[`#${id}`].visible, false, id);
  assert.equal(found['#caja'], undefined);
  assert.equal(found['#texto'].visible, true);
});

test('R1: sin id, el selector es data-testid o el camino corto hasta el elemento', () => {
  const body = node('body', { children: [node('nav', { children: [node('button', { attrs: { 'data-testid': 'menu' }, text: 'x' }), node('button', { text: 'a' }), node('button', { text: 'b' })] })] });
  assert.deepEqual(run(body).map((e) => e.selector), ['[data-testid="menu"]', 'nav > button:nth-of-type(2)', 'nav > button:nth-of-type(3)']);
});

// ── el medidor, con un navegador de mentira ────────────────────────────────────────────────────────
function fakeSession({ elements = [{ selector: '#a' }], navigateError = '', exception = '' } = {}) {
  const calls = [];
  const results = {
    'Target.createTarget': { targetId: 'T' }, 'Target.attachToTarget': { sessionId: 'S' }, 'Page.navigate': navigateError ? { errorText: navigateError } : { frameId: 'F' },
    'Runtime.evaluate': exception ? { exceptionDetails: { text: exception } } : { result: { value: elements } }, 'Page.captureScreenshot': { data: Buffer.from('png').toString('base64') }
  };
  return { calls, send: async (method, params, sessionId) => { calls.push([method, params, sessionId]); return results[method] || {}; }, once: async (event, sessionId) => { calls.push([`once:${event}`, sessionId]); return {}; } };
}
const VIEWS = [{ name: 'movil', width: 375, height: 812 }, { name: 'escritorio', width: 1440, height: 900 }];

test('R1: cada URL se mide en cada ancho: tamaño de la vista, carga, sonda y captura', async () => {
  const session = fakeSession();
  const out = await measurePages(session, { urls: ['http://localhost:3000/pago'], viewports: VIEWS });
  assert.deepEqual(out.viewports.map((v) => [v.name, v.width, v.height, v.url, v.elements, v.screenshot.toString()]), [
    ['movil', 375, 812, 'http://localhost:3000/pago', [{ selector: '#a' }], 'png'], ['escritorio', 1440, 900, 'http://localhost:3000/pago', [{ selector: '#a' }], 'png']]);
  const methods = session.calls.map(([method]) => method);
  assert.deepEqual(methods.slice(0, 3), ['Target.createTarget', 'Target.attachToTarget', 'Page.enable']);
  assert.deepEqual(methods.slice(3, 8), ['Emulation.setDeviceMetricsOverride', 'once:Page.loadEventFired', 'Page.navigate', 'Runtime.evaluate', 'Page.captureScreenshot'], 'la espera de la carga se arma ANTES de navegar');
  const metrics = session.calls.find(([method]) => method === 'Emulation.setDeviceMetricsOverride');
  assert.deepEqual(metrics.slice(1), [{ width: 375, height: 812, deviceScaleFactor: 1, mobile: false }, 'S']);
  const evaluate = session.calls.find(([method]) => method === 'Runtime.evaluate')[1];
  assert.deepEqual([evaluate.expression, evaluate.returnByValue], [PROBE, true]);
});

test('R1: con varias URL, cada vista dice de qué página es', async () => {
  const out = await measurePages(fakeSession(), { urls: ['http://localhost/a', 'http://localhost/b'], viewports: [VIEWS[0]] });
  assert.deepEqual(out.viewports.map((v) => v.name), ['movil · http://localhost/a', 'movil · http://localhost/b']);
});

test('R5: una página que no carga, o una sonda que falla, se dice con su URL', async () => {
  await assert.rejects(measurePages(fakeSession({ navigateError: 'net::ERR_CONNECTION_REFUSED' }), { urls: ['http://localhost:9/x'], viewports: VIEWS }), /http:\/\/localhost:9\/x.*ERR_CONNECTION_REFUSED/);
  await assert.rejects(measurePages(fakeSession({ exception: 'Uncaught' }), { urls: ['http://localhost/x'], viewports: VIEWS }), /http:\/\/localhost\/x.*Uncaught/);
  await assert.rejects(measurePages(fakeSession({ elements: 'no-lista' }), { urls: ['http://localhost/x'], viewports: VIEWS }), /http:\/\/localhost\/x/);
});

test('R4: solo páginas locales', () => {
  for (const url of ['http://localhost:3000/x', 'http://127.0.0.1/', 'https://localhost', 'http://[::1]:8080/a', 'file:///tmp/a.html']) assert.equal(localOnly(url), true, url);
  for (const url of ['https://example.com', 'http://localhost.evil.com', 'http://127.0.0.1.evil.com/', 'javascript:alert(1)', 'ftp://localhost/x', 'no es una url', '', 'http://192.168.1.10/']) assert.equal(localOnly(url), false, url);
});
