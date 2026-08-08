// T27 (R18) — el portón no instala nada, nunca.
//
// No es una formalidad: la primera corrida real de `gate.mjs` se trajo `stryker@1.0.1` de internet
// porque `npx` descarga lo que no encuentra. El portón corre en el repo del usuario, a veces en CI,
// a veces sin red — y bajarse un paquete a mitad de una comprobación de calidad es a la vez un
// riesgo de suministro y una fuente de resultados irreproducibles.
//
// Hay tres superficies por las que podría colarse: los comandos que la detección propone, los
// procesos que el portón lanza, y lo que el árbol emitido importa. Se vigilan las tres.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectGateConfig } from '../lib/gatedetect.mjs';
import { emitGate, GATE_DIR } from '../lib/gateemit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Verbos que instalan. Si uno de estos aparece en algo EJECUTABLE, el portón deja de ser inocuo.
const INSTALLER = /\b(?:npm (?:i|install|add)|yarn add|pnpm add|pip install|uv add|dotnet tool install|cargo install|composer require|apt-get|brew install)\b/;

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-noinstall-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

// Todos los .mjs del portón, en rutas relativas.
async function gateModules(rel = '') {
  const out = [];
  for (const entry of await readdir(join(GATE_DIR, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await gateModules(child));
    else if (child.endsWith('.mjs')) out.push(child);
  }
  return out;
}

const importsOf = (source) => [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

const STACKS = {
  js: { 'package.json': { name: 'x', devDependencies: { jest: '^29.0.0' }, scripts: { test: 'jest' } } },
  dotnet: { 'Api.csproj': '<Project />' },
  dart: { 'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n' },
  python: { 'requirements.txt': 'pytest\n' },
  maven: { 'pom.xml': '<project />' },
  rust: { 'Cargo.toml': '[package]\nname = "x"\n' },
  php: { 'composer.json': { name: 'x/y' } }
};

// ── 1. lo que la detección propone ejecutar ───────────────────────────────────────────────────

test('no detected command installs anything, in any stack', async () => {
  for (const [stack, files] of Object.entries(STACKS)) {
    const cfg = await detectGateConfig(await project(files));

    assert.doesNotMatch(cfg.test.command, INSTALLER, `el comando de tests de ${stack} instala`);
    assert.doesNotMatch(cfg.mutation.command, INSTALLER, `el comando de mutación de ${stack} instala`);
  }
});

// `npx` sin `--no-install` descarga del registro lo que no encuentra: es una instalación silenciosa
// aunque el comando no diga "install" por ninguna parte.
test('every npx command refuses to fetch what it cannot find', async () => {
  for (const [stack, files] of Object.entries(STACKS)) {
    const cfg = await detectGateConfig(await project(files));

    for (const command of [cfg.test.command, cfg.mutation.command]) {
      if (command.includes('npx')) {
        assert.match(command, /npx\s+--no-install\b/, `${stack}: "${command}" descargaría la herramienta ausente`);
      }
    }
  }
});

// La contraparte: el comando de instalación SÍ existe, pero como texto que se imprime cuando falta
// la herramienta. Distinguir dato de ejecución es justo lo que hace segura a la etapa.
test('the install command travels as data to be printed, never to be run', async () => {
  const cfg = await detectGateConfig(await project(STACKS.js));

  assert.match(cfg.mutation.install, INSTALLER, 'el bloqueo tiene que poder decir cómo instalarla');
  assert.doesNotMatch(cfg.mutation.command, INSTALLER);
});

// ── 2. los procesos que el portón lanza ───────────────────────────────────────────────────────

// Con una sola puerta de ejecución (y `changed.mjs`, que solo consulta git) es verificable de un
// vistazo que el portón no lanza nada por su cuenta: corre lo que dice `gate.json` y nada más.
test('only the command runner and the git reader can spawn a process', async () => {
  const allowed = new Set(['lib/run.mjs', 'lib/changed.mjs']);

  for (const rel of await gateModules()) {
    const source = await readFile(join(GATE_DIR, rel), 'utf8');
    if (/node:child_process/.test(source)) {
      assert.ok(allowed.has(rel), `${rel} lanza procesos y no debería`);
    }
  }
});

test('the gate reads git without ever writing to it', async () => {
  const source = await readFile(join(GATE_DIR, 'lib', 'changed.mjs'), 'utf8');
  const args = [...source.matchAll(/\[([^\]]*)\]\s*,\s*(?:root|cwd)/g)].map((m) => m[1]);

  assert.ok(args.length, 'no se encontraron las invocaciones de git');
  for (const call of args) {
    assert.doesNotMatch(call, /'(?:commit|push|checkout|reset|clean|add|rm|stash)'/, `git de escritura: ${call}`);
  }
});

// ── 3. lo que el árbol emitido arrastra ───────────────────────────────────────────────────────

// El portón corre con `node .chalc/gate.mjs` en un repo que no tiene chalc instalado: si importara
// algo de fuera, no arrancaría — y "no arrancó" acabaría tratándose como "no aplica".
test('the real gate tree imports only node builtins and its own files', async () => {
  for (const rel of await gateModules()) {
    for (const spec of importsOf(await readFile(join(GATE_DIR, rel), 'utf8'))) {
      assert.ok(spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../'),
        `${rel} importa un paquete externo: ${spec}`);
      if (spec.startsWith('node:')) continue;

      const target = resolve(dirname(join(GATE_DIR, rel)), spec);
      assert.ok(existsSync(target), `${rel} importa un archivo que no existe: ${spec}`);
      assert.ok(target.startsWith(GATE_DIR), `${rel} importa fuera del portón: ${spec}`);
    }
  }
});

test('there is no package manifest inside the gate: nothing to install', async () => {
  for (const name of ['package.json', 'package-lock.json', 'requirements.txt']) {
    assert.ok(!existsSync(join(GATE_DIR, name)), `el portón no puede traer ${name}`);
  }
});

test('emitting the gate touches nothing outside .chalc and pulls no dependency', async () => {
  const proj = await project(STACKS.js);

  const { written } = await emitGate(proj, { role: 'back', language: 'es' });

  assert.ok(written.every((p) => p.startsWith('.chalc/')), 'la emisión se salió de .chalc/');
  assert.ok(!existsSync(join(proj, 'node_modules')), 'la emisión instaló dependencias');
  assert.deepEqual((await readdir(proj)).sort(), ['.chalc', 'package.json']);
});
