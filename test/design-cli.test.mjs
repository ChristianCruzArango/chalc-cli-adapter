// Spec 038 (contrato de diseño), T3 — `node .chalc/design.mjs check` (R5): cada hallazgo sale con su arreglo
// exacto, en el idioma del proyecto, y el comando falla si hay alguno.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { writeFiles } from './helpers/teamrepo.mjs';
import { main } from '../catalog/design/design.mjs';
import { MESSAGES, messageOf } from '../catalog/design/lib/i18n.mjs';
import { DESIGN_RULES } from '../catalog/design/lib/evaluate.mjs';

const el = (selector, x, extra = {}) => ({ selector, interactive: true, visible: true, rect: { x, y: 16, width: 100, height: 44 }, fontSize: 16, color: '#000', background: '#fff', text: selector, ...extra });
const view = (elements) => JSON.stringify({ viewports: [{ name: 'movil', width: 375, height: 812, elements }] });
const CLOSE = view([el('#guardar', 16), el('#cancelar', 118)]);
const FINE = view([el('#guardar', 16), el('#cancelar', 124)]);
async function project(t, { language = 'es', files = {} } = {}) {
  const root = await tempDir(t, 'chalc-038-cli-');
  await writeFiles(root, { '.chalc/gate.json': JSON.stringify({ language }), 'medidas.json': CLOSE, 'bien.json': FINE, ...files });
  return root;
}
const run = async (root, ...args) => { const lines = []; return { code: await main({ argv: ['node', 'design.mjs', ...args], cwd: root, write: (l) => lines.push(l) }), text: lines.join('\n') }; };

test('paridad: cada regla del evaluador tiene su mensaje en los dos idiomas, y ninguno sobra', () => {
  const rules = Object.values(DESIGN_RULES).sort();
  for (const lang of ['es', 'en']) assert.deepEqual(Object.keys(MESSAGES[lang].rules).sort(), rules, lang);
  const keys = (o) => Object.keys(o).filter((k) => k !== 'rules').sort();
  assert.deepEqual(keys(MESSAGES.es), keys(MESSAGES.en));
});

test('R5: el mensaje de dos botones muy juntos dice cuáles, cuánto hay, cuánto se pide y cuánto falta', () => {
  const finding = { rule: DESIGN_RULES.tooClose, viewport: 'movil', selector: '#guardar', data: { other: '#cancelar', gap: 2, min: 8, missing: 6 } };
  for (const lang of ['es', 'en']) {
    const text = messageOf(finding, lang);
    for (const piece of ['movil', '#guardar', '#cancelar', '2', '8', '6']) assert.ok(text.includes(piece), `${lang}: ${piece}`);
  }
  assert.ok(messageOf({ rule: 'regla-desconocida', viewport: 'v', selector: 's', data: {} }, 'es').includes('regla-desconocida'));
});

test('R5: cada regla se puede escribir con sus cifras, sin dejar un «undefined»', () => {
  const data = { other: '#b', gap: 2, min: 8, missing: 6, width: 30, height: 30, step: 4, size: 10, ratio: 4.48, count: 2, max: 1, others: ['#b'], right: 416 };
  for (const lang of ['es', 'en']) for (const rule of Object.values(DESIGN_RULES)) {
    const text = messageOf({ rule, viewport: 'movil', selector: '#a', data }, lang);
    assert.equal(/undefined|NaN/.test(text), false, `${lang} ${rule}: ${text}`);
    assert.ok(text.includes('#a') && text.includes('movil'), `${lang} ${rule}`);
  }
});

test('R5: `check` escribe los hallazgos en el idioma del proyecto y sale con 1', async (t) => {
  for (const lang of ['es', 'en']) {
    const out = await run(await project(t, { language: lang }), 'check', 'medidas.json');
    assert.equal(out.code, 1);
    assert.ok(out.text.includes(messageOf({ rule: DESIGN_RULES.tooClose, viewport: 'movil', selector: '#guardar', data: { other: '#cancelar', gap: 2, min: 8, missing: 6 } }, lang)), out.text);
    assert.ok(out.text.includes(MESSAGES[lang].found(1)));
  }
});

test('R5: sin hallazgos lo dice y sale con 0', async (t) => {
  const out = await run(await project(t), 'check', 'bien.json');
  assert.deepEqual([out.code, out.text], [0, MESSAGES.es.clean]);
});

test('R5: usa el contrato del proyecto, y con --spec el de esa carpeta', async (t) => {
  const root = await project(t, { files: { '.chalc/design.contract.json': JSON.stringify({ spacing: { minGap: 2, enforceScale: false } }), 'specs/027-x/design.contract.json': JSON.stringify({ spacing: { minGap: 8 } }) } });
  assert.equal((await run(root, 'check', 'medidas.json')).code, 0, 'el proyecto acepta 2 px');
  assert.equal((await run(root, 'check', 'medidas.json', '--spec', 'specs/027-x')).code, 1, 'esa spec pide 8');
});

test('R5: un archivo que no existe o no son medidas, sin archivo o un comando desconocido: error y uso', async (t) => {
  const root = await project(t, { files: { 'roto.json': '{ no', 'otra-cosa.json': '{"hola":1}' } });
  for (const args of [['check', 'no-existe.json'], ['check', 'roto.json'], ['check', 'otra-cosa.json']]) {
    const out = await run(root, ...args);
    assert.deepEqual([out.code, out.text.includes(MESSAGES.es.unreadable(args[1]))], [1, true], args[1]);
  }
  for (const args of [['check'], [], ['inventado']]) {
    const out = await run(root, ...args);
    assert.deepEqual([out.code, out.text], [1, MESSAGES.es.usage], args.join(' '));
  }
});

test('`contract` muestra el contrato vigente como JSON', async (t) => {
  const root = await project(t, { files: { '.chalc/design.contract.json': JSON.stringify({ maxPrimary: 2 }) } });
  const out = await run(root, 'contract');
  assert.equal(out.code, 0);
  assert.deepEqual([JSON.parse(out.text).maxPrimary, JSON.parse(out.text).spacing.minGap], [2, 8]);
});
