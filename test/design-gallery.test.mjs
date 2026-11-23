// Spec 040 (revisión visual y galería), T1 — la galería (R1, R2): cada vista con su captura y sus hallazgos, para
// que quien revisa el diseño y quien aprueba el cierre miren pantallas de verdad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { gitRepo, git, writeFiles } from './helpers/teamrepo.mjs';
import { galleryHtml } from '../catalog/design/lib/gallery.mjs';
import { main } from '../catalog/design/design.mjs';
import { MESSAGES } from '../catalog/design/lib/i18n.mjs';

const view = (name, extra = {}) => ({ name, width: 375, height: 812, url: 'http://localhost/pago', screenshot: `${name}.png`, elements: [], ...extra });
const finding = (viewport, selector = '#guardar') => ({ rule: 'design-interactive-too-close', viewport, selector, data: { other: '#cancelar', gap: 2, min: 8, missing: 6 } });

for (const lang of ['es', 'en']) {
  test(`R1 (${lang}): la galería trae cada vista con su captura, su tamaño y sus hallazgos escritos`, () => {
    const html = galleryHtml({ measurements: { commit: 'abc1234', viewports: [view('movil'), view('escritorio', { width: 1440, height: 900 })] }, findings: [finding('movil')], lang });
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes(`<html lang="${lang}">`));
    for (const piece of [MESSAGES[lang].gallery.title, 'movil', 'escritorio', 'src="movil.png"', 'src="escritorio.png"', '375×812', '1440×900', 'abc1234', MESSAGES[lang].gallery.clean, '2 px', '#guardar']) assert.ok(html.includes(piece), piece);
    assert.equal((html.match(/<img /g) || []).length, 2);
    assert.equal(/<script/i.test(html), false, 'una página estática: sin scripts');
  });
}

test('R1: sin hallazgos lo dice arriba; con ellos, cuántos', () => {
  const clean = galleryHtml({ measurements: { viewports: [view('movil')] }, findings: [], lang: 'es' });
  assert.ok(clean.includes(MESSAGES.es.clean));
  const dirty = galleryHtml({ measurements: { viewports: [view('movil')] }, findings: [finding('movil'), finding('movil', '#otro')], lang: 'es' });
  assert.ok(dirty.includes(MESSAGES.es.found(2)));
});

test('R2: lo que viene de la página se escribe como texto, nunca como marcado', () => {
  const evil = '"><script>alert(1)</script>';
  const html = galleryHtml({ measurements: { commit: evil, viewports: [view(`movil${evil}`, { url: `http://localhost/${evil}`, screenshot: 'm"x.png' })] }, findings: [finding(`movil${evil}`, `#a${evil}`)], lang: 'es' });
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(html.includes('src="m"x.png"'), false);
});

test('R1: `measure` deja la galería junto a las capturas y anota el commit medido y los hallazgos', async (t) => {
  const root = await gitRepo(await tempDir(t, 'chalc-040-gallery-'), { '.chalc/gate.json': JSON.stringify({ language: 'es' }), '.gitignore': '.chalc/design-out/\n' });
  const el = (selector, x) => ({ selector, interactive: true, visible: true, rect: { x, y: 16, width: 100, height: 44 }, fontSize: 16, color: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)', text: selector });
  const results = { 'Target.createTarget': { targetId: 'T' }, 'Target.attachToTarget': { sessionId: 'S' }, 'Runtime.evaluate': { result: { value: [el('#guardar', 16), el('#cancelar', 118)] } }, 'Page.captureScreenshot': { data: Buffer.from('PNG').toString('base64') } };
  const launch = async () => ({ session: { send: async (method) => results[method] || {}, once: async () => ({}) }, close: async () => {} });
  const code = await main({ argv: ['node', 'design.mjs', 'measure', 'http://localhost/pago'], cwd: root, write: () => {}, launch });
  assert.equal(code, 1);
  const saved = JSON.parse(await readFile(join(root, '.chalc', 'design-out', 'measurements.json'), 'utf8'));
  assert.deepEqual([saved.commit, saved.findings], [git(root, 'rev-parse', 'HEAD').out, 3]);
  const html = await readFile(join(root, '.chalc', 'design-out', 'gallery.html'), 'utf8');
  assert.ok(html.includes('src="movil.png"') && html.includes('#guardar') && html.includes(saved.commit));
  // Fuera de un repo de git no hay commit que anotar, y medir sigue funcionando.
  const plain = await tempDir(t, 'chalc-040-gallery-');
  await writeFiles(plain, { '.chalc/gate.json': JSON.stringify({ language: 'es' }) });
  await main({ argv: ['node', 'design.mjs', 'measure', 'http://localhost/pago'], cwd: plain, write: () => {}, launch });
  assert.equal(JSON.parse(await readFile(join(plain, '.chalc', 'design-out', 'measurements.json'), 'utf8')).commit, '');
});
