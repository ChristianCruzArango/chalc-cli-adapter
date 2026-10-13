// T9 (spec 018, R6) — el manifiesto recuerda lo que se eligió.
//
// Encontrado en el E2E de la spec 017: `.chalc.json` guardaba target, stacks, skills, MCP y métodos, pero
// no el idioma del contenido ni la arquitectura. Re-equipar no tenía de dónde sacarlos: todo salió en
// inglés y la línea «Arquitectura acordada» del CLAUDE.md desapareció. Aquí el manifiesto los guarda;
// usarlos al re-equipar es T10.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeManifest } from '../lib/targetkit.mjs';

const dir = () => mkdtemp(join(tmpdir(), 'chalc-manifest-'));
const read = async (root) => JSON.parse(await readFile(join(root, '.chalc.json'), 'utf8'));
const EQUIPMENT = { stacks: [{ id: 'nestjs' }], skills: ['clean-code'], mcps: [], methods: [{ id: 'sdd', mode: 'lite' }] };

test('R6: the manifest keeps the content language, normalised to its code', async () => {
  for (const [specLang, code] of [['español', 'es'], ['es', 'es'], ['english', 'en'], ['en', 'en']]) {
    const root = await dir();
    await writeManifest(root, 'claude', { ...EQUIPMENT, specLang });
    assert.equal((await read(root)).lang, code, specLang);
  }
});

test('R6: the manifest keeps the agreed architecture, id and name', async () => {
  const root = await dir();
  await writeManifest(root, 'claude', { ...EQUIPMENT, specLang: 'es', architecture: { id: 'modular-feature', name: 'NestJS Modular por Features' } });
  assert.deepEqual((await read(root)).architecture, { id: 'modular-feature', name: 'NestJS Modular por Features' });
});

test('R6: without an architecture the manifest does not invent one', async () => {
  const root = await dir();
  await writeManifest(root, 'claude', { ...EQUIPMENT, specLang: 'es' });
  assert.equal('architecture' in (await read(root)), false);
});

test('R6: an architecture without id keeps its name, and nothing else', async () => {
  const root = await dir();
  await writeManifest(root, 'claude', { ...EQUIPMENT, specLang: 'es', architecture: { name: 'A medida' } });
  assert.deepEqual((await read(root)).architecture, { name: 'A medida' });
});

test('R6: what was already stored stays as it was, method mode included', async () => {
  const root = await dir();
  await writeManifest(root, 'claude', { ...EQUIPMENT, specLang: 'es' });
  const manifest = await read(root);
  assert.deepEqual({ target: manifest.target, stacks: manifest.stacks, skills: manifest.skills, mcp: manifest.mcp, methods: manifest.methods }, {
    target: 'claude', stacks: ['nestjs'], skills: ['clean-code'], mcp: [], methods: ['sdd:lite']
  });
});

test('R6: without a content language the manifest stores the interface one', async () => {
  const { lang } = await import('../lib/i18n.mjs');
  const root = await dir();
  await writeManifest(root, 'claude', EQUIPMENT);
  assert.equal((await read(root)).lang, lang === 'es' ? 'es' : 'en');
});

test('R6: an unsafe architecture id is rejected, like every other id in the manifest', async () => {
  const root = await dir();
  await assert.rejects(writeManifest(root, 'claude', { ...EQUIPMENT, architecture: { id: '../x', name: 'X' } }), /architecture id/);
});
