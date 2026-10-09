// T-01 (spec 016, R27) — la cobertura se mide sobre un universo de fuentes EXPLÍCITO (las raíces de
// código que se distribuyen) y los módulos que ningún test carga en proceso están registrados con su
// motivo. Si un módulo nuevo queda sin pruebas, o uno registrado pasa a tenerlas, este test lo dice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Raíces de código ejecutable que se distribuyen (package.json "files"). Del catálogo, solo lo que se ejecuta.
const SOURCE_ROOTS = ['bin', 'cli', 'lib', 'targets', 'catalog/gate', 'catalog/next', 'catalog/memory', 'catalog/mail'];

// Módulos que ningún test carga EN PROCESO, con el motivo. La cobertura en proceso no los ve. (Los
// comandos de lib/commands se cargan desde el registro de verbos —lib/commands/verbs.mjs, M-04—.)
const NOT_LOADED_IN_PROCESS = {
  'bin/chalc.mjs': 'entrypoint: se ejecuta al importarse; los tests lo lanzan en subproceso',
  'cli/index.mjs': 'entrypoint de chalc-cli: arranca main() al importarse',
  'catalog/mail/mail.mjs': 'CLI emitida a los proyectos: se ejecuta al importarse'
};

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : path.endsWith('.mjs') ? [path] : [];
});
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|import\s+['"](\.{1,2}\/[^'"]+)['"]/g;

// Módulos alcanzables desde los tests siguiendo imports relativos estáticos (y dinámicos literales).
function reachedFromTests() {
  const seen = new Set();
  const stack = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.mjs')).map((f) => join(ROOT, 'test', f));
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const target = resolve(dirname(file), m[1] || m[2] || m[3]);
      if (existsSync(target)) stack.push(target);
    }
  }
  return new Set([...seen].map((p) => relative(ROOT, p).replace(/\\/g, '/')));
}

test('R27: the coverage script measures exactly the shipped source roots, tests excluded', () => {
  const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['test:coverage'];
  const includes = [...script.matchAll(/--test-coverage-include=(\S+)/g)].map((m) => m[1].replace(/^['"]|['"]$/g, ''));
  assert.deepEqual(includes.sort(), SOURCE_ROOTS.map((r) => `${r}/**`).sort());
  assert.match(script, /--test-coverage-exclude=test\/\*\*/);
});

test('R27: every module no test loads in process is registered with its reason (and only those)', () => {
  const runtime = SOURCE_ROOTS.flatMap((r) => walk(join(ROOT, r))).map((p) => relative(ROOT, p).replace(/\\/g, '/'));
  const reached = reachedFromTests();
  const notLoaded = runtime.filter((m) => !reached.has(m)).sort();
  assert.deepEqual(notLoaded, Object.keys(NOT_LOADED_IN_PROCESS).sort());
});
