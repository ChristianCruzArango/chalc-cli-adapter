// T13 (R1, R2, R3) — dejar el advisor dentro del repo del usuario.
//
// chalc es un EQUIPADOR: corre una vez y se va. Todo lo que deja tiene que funcionar después sin
// chalc instalado, sin red y sin `npm install` — un repo equipado hoy tiene que poder correr
// `node .chalc/next.mjs` dentro de dos años en una máquina sin nada.
//
// De ahí las tres cosas que se vigilan aquí: que el árbol llegue completo, que lo emitido solo
// importe builtins de Node o rutas de dentro de `.chalc/`, y que re-equipar regenere el código sin
// pisar lo que el usuario haya ajustado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emitNext, NEXT_DIR, NEXT_REL } from '../lib/nextemit.mjs';

const project = () => mkdtemp(join(tmpdir(), 'chalc-next-emit-'));

// Todos los .mjs del catálogo del advisor, en rutas relativas.
async function sourceModules(rel = '') {
  const out = [];
  for (const entry of await readdir(join(NEXT_DIR, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await sourceModules(child));
    else if (entry.name.endsWith('.mjs')) out.push(child);
  }
  return out;
}

// ── R1: el árbol llega entero y con su lanzador ───────────────────────────────────────────────

test('R1 — emitNext deja el lanzador y los módulos bajo .chalc/', async () => {
  const dir = await project();
  const { written } = await emitNext(dir);

  assert.ok(written.includes(NEXT_REL), 'falta la entrada .chalc/next.mjs');
  assert.ok(existsSync(join(dir, NEXT_REL)));
  for (const rel of await sourceModules()) {
    assert.ok(existsSync(join(dir, '.chalc', 'next', rel)), `no se copió ${rel}`);
  }
});

test('R1 — todo lo emitido cuelga de .chalc/: nada se riega por el repo', async () => {
  const dir = await project();
  const { written } = await emitNext(dir);

  for (const rel of written) assert.match(rel, /^\.chalc\//, `${rel} está fuera de .chalc/`);
});

test('R1 — el lanzador es de una línea y apunta al árbol, no lo reemplaza', async () => {
  // Mover el archivo real un nivel arriba le rompería sus propios imports relativos.
  const dir = await project();
  await emitNext(dir);

  const launcher = await readFile(join(dir, NEXT_REL), 'utf8');
  assert.match(launcher, /import '\.\/next\/next\.mjs'/);
  assert.match(launcher, /chalc/i, 'el lanzador lleva la marca de que lo genera chalc');
});

// ── R2: cero dependencias, verificado sobre lo emitido ────────────────────────────────────────

test('R2 — lo emitido solo importa builtins de Node o rutas relativas de dentro de .chalc/', async () => {
  const dir = await project();
  await emitNext(dir);

  const files = await sourceModules();
  for (const rel of files) {
    const code = await readFile(join(dir, '.chalc', 'next', rel), 'utf8');
    for (const [, spec] of code.matchAll(/(?:^|\n)\s*import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g)) {
      const ok = spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../');
      assert.ok(ok, `${rel} importa "${spec}": el advisor no puede depender de paquetes`);
    }
  }
});

test('R2 — ninguna ruta relativa se escapa de .chalc/', async () => {
  // `../../gate/lib/changed.mjs` desde `.chalc/next/lib/` aterriza en `.chalc/gate/lib/`: válido.
  // Un nivel más y estaríamos leyendo código de fuera del árbol emitido.
  const dir = await project();
  await emitNext(dir);

  for (const rel of await sourceModules()) {
    const code = await readFile(join(dir, '.chalc', 'next', rel), 'utf8');
    const depth = rel.split('/').length;   // next.mjs → 1, lib/x.mjs → 2
    for (const [, spec] of code.matchAll(/from\s+['"](\.\.[^'"]*)['"]/g)) {
      const ups = (spec.match(/\.\.\//g) || []).length;
      assert.ok(ups <= depth, `${rel} sale de .chalc/next con "${spec}"`);
    }
  }
});

test('R2 — el advisor no lleva ningún verbo que instale', async () => {
  const installer = /\b(?:npm (?:i|install|add)|yarn add|pnpm add|pip install|cargo install|composer require)\b/;
  const dir = await project();
  await emitNext(dir);

  for (const rel of await sourceModules()) {
    const code = await readFile(join(dir, '.chalc', 'next', rel), 'utf8');
    assert.ok(!installer.test(code), `${rel} contiene un comando de instalación`);
  }
});

// ── R3: re-equipar regenera el código y respeta lo del usuario ────────────────────────────────

test('R3 — re-equipar pisa el código emitido: es artefacto de chalc, no superficie de edición', async () => {
  const dir = await project();
  await emitNext(dir);

  const touched = join(dir, '.chalc', 'next', 'lib', 'decide.mjs');
  await writeFile(touched, '// alguien lo editó a mano\n', 'utf8');
  await emitNext(dir);

  assert.notEqual(await readFile(touched, 'utf8'), '// alguien lo editó a mano\n');
  assert.match(await readFile(touched, 'utf8'), /decide/);
});

test('R3 — emitNext NO toca .chalc/gate.json: la config no es suya', async () => {
  const dir = await project();
  await mkdir(join(dir, '.chalc'), { recursive: true });
  const config = JSON.stringify({ flow: { approvals: { task: false } } }, null, 2);
  await writeFile(join(dir, '.chalc', 'gate.json'), config, 'utf8');

  await emitNext(dir);

  assert.equal(await readFile(join(dir, '.chalc', 'gate.json'), 'utf8'), config);
});

test('R3 — emitNext no borra lo que el portón dejó al lado', async () => {
  const dir = await project();
  await mkdir(join(dir, '.chalc', 'gate', 'lib'), { recursive: true });
  await writeFile(join(dir, '.chalc', 'gate', 'lib', 'changed.mjs'), '// del portón\n', 'utf8');

  await emitNext(dir);

  assert.equal(await readFile(join(dir, '.chalc', 'gate', 'lib', 'changed.mjs'), 'utf8'), '// del portón\n');
});
