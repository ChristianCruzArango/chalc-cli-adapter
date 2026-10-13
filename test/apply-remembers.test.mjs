// T10 (spec 018, R7, R8) — re-equipar respeta lo que el proyecto ya eligió.
//
// Encontrado en el E2E de la spec 017: `chalc <ruta> --yes` sobre un proyecto creado con `chalc init
// --lang es` (SDD lite, arquitectura NestJS Modular por Features) lo pasó todo a inglés, le quitó el método
// SDD y borró la línea «Arquitectura acordada» del CLAUDE.md. El manifiesto (T9) guarda ahora esas
// elecciones; re-equipar las usa como valores por defecto, y un flag explícito les gana. Se prueba con el
// CLI real, como lo usa el usuario.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
// La interfaz en inglés A PROPÓSITO: el contenido tiene que salir del manifiesto, no de ella.
const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], {
  cwd, encoding: 'utf8', input: '', timeout: 60000, env: { ...process.env, CHALC_LANG: 'en' }
});

function project(manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'chalc-remember-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { '@nestjs/core': '11' } }));
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'architecture.md'), '# Arquitectura\n');
  if (manifest) writeFileSync(join(dir, '.chalc.json'), JSON.stringify(manifest));
  return dir;
}

const REMEMBERED = { target: 'claude', stacks: ['nestjs'], skills: [], mcp: [], methods: ['sdd:lite'], lang: 'es', architecture: { id: 'modular-feature', name: 'NestJS Modular por Features' } };
const claudeMd = (dir) => readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
const manifestOf = (dir) => JSON.parse(readFileSync(join(dir, '.chalc.json'), 'utf8'));

test('R7: without flags, re-equipping keeps the language, the method and the architecture', () => {
  const dir = project(REMEMBERED);
  const r = run(['--yes', '--target', 'claude'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const md = claudeMd(dir);
  assert.match(md, /Skills activas/, 'content in Spanish, as stored');
  assert.match(md, /Arquitectura acordada: \*\*NestJS Modular por Features\*\*/);
  assert.match(md, /Spec-Driven Development/, 'the SDD method is still there');
  assert.match(md, /Flujo obligatorio/, 'and its text is in the content language, not the interface one');
  assert.doesNotMatch(md, /Mandatory flow/);
  assert.ok(existsSync(join(dir, 'specs', 'constitution.md')));
  assert.match(readFileSync(join(dir, '.claude', 'agents', 'revisor.md'), 'utf8'), /Tus hallazgos de la pasada anterior/);
  assert.deepEqual({ lang: manifestOf(dir).lang, methods: manifestOf(dir).methods, architecture: manifestOf(dir).architecture }, {
    lang: 'es', methods: ['sdd:lite'], architecture: REMEMBERED.architecture
  });
});

test('R7: an explicit --lang wins over the manifest, and is stored', () => {
  const dir = project(REMEMBERED);
  const r = run(['--yes', '--target', 'claude', '--lang', 'en'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(claudeMd(dir), /Active skills/);
  assert.equal(manifestOf(dir).lang, 'en');
});

test('R7: an explicit --method wins over the remembered one', () => {
  const dir = project(REMEMBERED);
  const r = run(['--yes', '--target', 'claude', '--method', 'sdd:full'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(manifestOf(dir).methods, ['sdd:full']);
});

test('R8: without a manifest, or with an old or broken one, it behaves as before', () => {
  for (const manifest of [null, { target: 'claude', stacks: [], skills: [], mcp: [], methods: [] }]) {
    const dir = project(manifest);
    const r = run(['--yes', '--target', 'claude'], dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(claudeMd(dir), /Active skills/, 'the interface language, as before');
    assert.doesNotMatch(claudeMd(dir), /Agreed architecture: \*\*/);
  }
  const dir = project();
  writeFileSync(join(dir, '.chalc.json'), '{ esto no es json');
  assert.equal(run(['--yes', '--target', 'claude'], dir).status, 0);
});
