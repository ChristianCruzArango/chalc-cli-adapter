// T7 (R1, R15) — el portón llega al repo cuando se equipa.
//
// Es el cable que hace que todo lo anterior exista de verdad: `spec-ia` y `feature` equipan cada
// repo (back, front, móvil) llamando a `equipForSpec`, así que emitir ahí es emitir en los tres sin
// añadir un comando nuevo. Y en modo worktree `equipForSpec` recibe la ruta del worktree, con lo que
// R15 —no tocar el repo principal— se cumple por construcción; este test lo fija por escrito.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { equipForSpec } from '../lib/commands/equip.mjs';

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-equip-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

const jest = () => project({
  'package.json': { name: 'demo', devDependencies: { jest: '^29.0.0' }, scripts: { test: 'jest' } }
});

test('equipForSpec leaves a runnable gate in the equipped repo', async () => {
  const proj = await jest();

  await equipForSpec(proj, 'lite', 'claude', 'español');

  assert.ok(existsSync(join(proj, '.chalc', 'gate.mjs')), 'falta la entrada del portón');
  assert.ok(existsSync(join(proj, '.chalc', 'gate', 'gate.mjs')));
  assert.ok(existsSync(join(proj, '.chalc', 'gate', 'lib', 'mutation.mjs')));
  assert.ok(existsSync(join(proj, '.chalc', 'gate.json')));
});

test('equipForSpec configures the gate from the real signals of the repo', async () => {
  const proj = await jest();

  await equipForSpec(proj, 'lite', 'claude', 'español');

  const cfg = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  assert.equal(cfg.test.command, 'npm test');
  assert.equal(cfg.mutation.tool, 'stryker');
  assert.match(cfg.mutation.install, /jest-runner/, 'el runner sale del framework detectado');
});

// El portón habla el idioma del spec, no el del CLI: es el repo del usuario, no la consola.
test('equipForSpec records the spec language and the role of the repo', async () => {
  const proj = await jest();

  await equipForSpec(proj, 'lite', 'claude', 'español', { role: 'back' });

  const cfg = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  assert.equal(cfg.language, 'es');
  assert.equal(cfg.role, 'back');
});

test('equipForSpec leaves no role when the repo is not a side of a full-stack feature', async () => {
  const proj = await jest();

  await equipForSpec(proj, 'lite', 'claude', 'english');

  const cfg = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  assert.equal(cfg.role, '');
  assert.equal(cfg.language, 'en');
});

// R15: en modo worktree se equipa la ruta del worktree. Nada puede aparecer en el repo principal.
test('equipping a worktree writes the gate inside it and nothing in the main repo', async () => {
  const main = await jest();
  const worktree = await jest();

  await equipForSpec(worktree, 'lite', 'claude', 'español', { role: 'front' });

  assert.ok(existsSync(join(worktree, '.chalc', 'gate.mjs')));
  assert.ok(!existsSync(join(main, '.chalc')), 'el repo principal no puede recibir nada');
});

// Re-equipar es lo normal: cada `spec-ia` vuelve a pasar por aquí. La config del usuario aguanta.
test('re-equipping keeps what the user configured in gate.json', async () => {
  const proj = await jest();
  await equipForSpec(proj, 'lite', 'claude', 'español');

  const path = join(proj, '.chalc', 'gate.json');
  const cfg = JSON.parse(await readFile(path, 'utf8'));
  cfg.mutation.threshold = 65;
  cfg.test.command = 'npm run test:ci';
  await writeFile(path, JSON.stringify(cfg, null, 2), 'utf8');

  await equipForSpec(proj, 'lite', 'claude', 'español');

  const after = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(after.mutation.threshold, 65);
  assert.equal(after.test.command, 'npm run test:ci');
});
