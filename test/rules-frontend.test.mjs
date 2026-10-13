// T11 (spec 018, R13) — las skills de diseño frontend solo van a quien tiene interfaz web.
//
// Encontrado en el E2E de la spec 017: un backend NestJS recibió `frontend-design` y
// `high-end-visual-design`, porque `rules/global.json` las daba a todo proyecto (commit 4894789). Decisión
// del usuario (2026-10-13): solo con un framework web de UI. `react-dom` y no `react`, para no dárselas a
// React Native / Expo, que son móvil.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectContext, matchRules } from '../lib/detect.mjs';
import { loadJsonDir } from '../lib/commands/catalogstore.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = ['frontend-design', 'high-end-visual-design'];

async function skillsFor(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-frontend-'));
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  const rules = await loadJsonDir(join(ROOT, 'rules'));
  return matchRules(rules, await detectContext(dir)).flatMap((r) => r.skills || []);
}
const deps = (...names) => ({ 'package.json': { name: 'x', dependencies: Object.fromEntries(names.map((n) => [n, '1'])) } });

test('R13: a backend gets no frontend design skills', async () => {
  for (const files of [deps('@nestjs/core'), deps('express'), { 'pyproject.toml': '[project]' }, { 'api.csproj': '<Project/>' }]) {
    const skills = await skillsFor(files);
    for (const skill of DESIGN) assert.ok(!skills.includes(skill), `${JSON.stringify(files)} → ${skill}`);
  }
});

test('R13: React Native / Expo are mobile, not web UI', async () => {
  const skills = await skillsFor(deps('react', 'react-native', 'expo'));
  for (const skill of DESIGN) assert.ok(!skills.includes(skill), skill);
});

test('R13: every web UI framework gets both design skills', async () => {
  for (const dep of ['@angular/core', 'react-dom', 'next', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', 'solid-js', 'astro', 'preact', 'lit']) {
    const skills = await skillsFor(deps(dep));
    for (const skill of DESIGN) assert.ok(skills.includes(skill), `${dep} → ${skill}`);
  }
});

test('R13: an angular.json without the dependency also counts as web UI', async () => {
  const skills = await skillsFor({ 'angular.json': '{}', 'package.json': { name: 'x' } });
  for (const skill of DESIGN) assert.ok(skills.includes(skill), skill);
});

test('R13: the global rule keeps everything else', async () => {
  const skills = await skillsFor(deps('@nestjs/core'));
  for (const skill of ['clean-code', 'minimal-implementation', 'solid-principles', 'modular-architecture', 'mutation-testing', 'secure-coding']) {
    assert.ok(skills.includes(skill), skill);
  }
});
