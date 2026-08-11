// T14 (R1, R4) — el advisor llega al repo al equiparlo, con CUALQUIER CLI.
//
// Este es el cable que hace real todo lo anterior. chalc es un equipador: el usuario elige su CLI
// —Claude Code, Codex, Copilot, Cursor o Gemini— y espera que al equipar quede TODO resuelto dentro
// del repo, sin pasos manuales después. `equipForSpec` es el único punto por el que pasan los tres
// consumidores (mono-repo, full-stack y worktree), así que emitir ahí los cubre a los tres.
//
// El caso del worktree importa aparte: `equipForSpec` recibe la ruta del worktree, de modo que R4
// —no tocar el repo principal— se cumple por construcción. Este test lo fija por escrito para que
// nadie lo rompa moviendo la llamada.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { equipForSpec } from '../lib/commands/equip.mjs';

const TARGETS = ['claude', 'codex', 'copilot', 'cursor', 'gemini'];

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-next-equip-'));
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

// ── R1: equipar deja el advisor listo para correr ─────────────────────────────────────────────

test('R1 — equipar deja el advisor ejecutable en el repo', async () => {
  const proj = await jest();

  await equipForSpec(proj, 'lite', 'claude', 'español');

  assert.ok(existsSync(join(proj, '.chalc', 'next.mjs')), 'falta la entrada del advisor');
  assert.ok(existsSync(join(proj, '.chalc', 'next', 'next.mjs')));
  assert.ok(existsSync(join(proj, '.chalc', 'next', 'lib', 'decide.mjs')));
  assert.ok(existsSync(join(proj, '.chalc', 'next', 'lib', 'snapshot.mjs')));
});

// El punto que el usuario pidió explícitamente: da igual qué CLI ponga, al equipar queda resuelto.
for (const target of TARGETS) {
  test(`R1 — con el target ${target}, equipar deja advisor y portón juntos`, async () => {
    const proj = await jest();

    await equipForSpec(proj, 'lite', target, 'español');

    assert.ok(existsSync(join(proj, '.chalc', 'next.mjs')), `${target}: falta el advisor`);
    assert.ok(existsSync(join(proj, '.chalc', 'gate.mjs')), `${target}: falta el portón`);
  });
}

test('R13 — el advisor se emite DESPUÉS del portón: importa su lector de cambios', async () => {
  const proj = await jest();

  await equipForSpec(proj, 'lite', 'claude', 'español');

  // La ruta que `snapshot.mjs` resuelve desde `.chalc/next/lib/`.
  assert.ok(existsSync(join(proj, '.chalc', 'gate', 'lib', 'changed.mjs')), 'el advisor quedaría colgando');
  const snapshot = await readFile(join(proj, '.chalc', 'next', 'lib', 'snapshot.mjs'), 'utf8');
  assert.match(snapshot, /\.\.\/\.\.\/gate\/lib\/changed\.mjs/);
});

test('R17 — equipar deja las puertas del advisor visibles en gate.json', async () => {
  const proj = await jest();

  await equipForSpec(proj, 'lite', 'claude', 'español');

  const cfg = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  assert.equal(cfg.flow.approvals.task, true);
  assert.equal(cfg.flow.review.required, true);
});

test('R3 — re-equipar no rompe lo que el usuario ajustó en las puertas', async () => {
  const proj = await jest();
  await equipForSpec(proj, 'lite', 'claude', 'español');

  const path = join(proj, '.chalc', 'gate.json');
  const cfg = JSON.parse(await readFile(path, 'utf8'));
  cfg.flow.approvals.task = false;
  await writeFile(path, JSON.stringify(cfg, null, 2), 'utf8');

  await equipForSpec(proj, 'lite', 'claude', 'español');

  assert.equal(JSON.parse(await readFile(path, 'utf8')).flow.approvals.task, false);
});

// ── R4: en modo worktree, el repo principal no se toca ────────────────────────────────────────

test('R4 — equipar un worktree no escribe nada en el repo principal', async () => {
  const main = await jest();
  const worktree = await jest();

  const before = (await readdir(main)).sort();
  await equipForSpec(worktree, 'lite', 'claude', 'español');

  assert.deepEqual((await readdir(main)).sort(), before, 'el repo principal quedó intacto');
  assert.ok(existsSync(join(worktree, '.chalc', 'next.mjs')), 'el advisor va DENTRO del worktree');
});
