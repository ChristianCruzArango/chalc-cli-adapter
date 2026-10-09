// M-01 (spec 016, R28) — no hay ciclos de imports estáticos en el código del CLI. Había
// specgen → feature → featureworktree → specgen (y feature → specgen): los comandos dependían de otros
// comandos para reutilizar la captura de la historia y del idioma del spec.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['bin', 'cli', 'lib', 'targets'];
const STATIC = /^\s*(?:import|export)\s[^;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm;

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.mjs') ? [p] : [];
});

function graph() {
  const edges = new Map();
  for (const file of ROOTS.flatMap((r) => walk(join(ROOT, r)))) {
    const from = relative(ROOT, file).replace(/\\/g, '/');
    edges.set(from, [...readFileSync(file, 'utf8').matchAll(STATIC)].map((m) => relative(ROOT, resolve(dirname(file), m[1])).replace(/\\/g, '/')));
  }
  return edges;
}

// Primer ciclo encontrado (DFS), como lista de módulos; [] si no hay.
function findCycle(edges) {
  const state = new Map();
  const path = [];
  const visit = (node) => {
    state.set(node, 'open');
    path.push(node);
    for (const next of edges.get(node) || []) {
      if (state.get(next) === 'open') return [...path.slice(path.indexOf(next)), next];
      if (!state.has(next)) { const found = visit(next); if (found.length) return found; }
    }
    path.pop();
    state.set(node, 'done');
    return [];
  };
  for (const node of edges.keys()) if (!state.has(node)) { const found = visit(node); if (found.length) return found; }
  return [];
}

test('R28: the detector finds a cycle when there is one', () => {
  assert.deepEqual(findCycle(new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]])), ['a', 'b', 'c', 'a']);
  assert.deepEqual(findCycle(new Map([['a', ['b']], ['b', []]])), []);
});

test('R28: there are no static import cycles in bin/, cli/, lib/ and targets/', () => {
  assert.deepEqual(findCycle(graph()), []);
});

test('R28: story capture and spec language live in a shared input module that imports no command', () => {
  const src = readFileSync(join(ROOT, 'lib/commands/storyinput.mjs'), 'utf8');
  assert.match(src, /export async function acquireUserStory/);
  assert.match(src, /export async function askSpecLang/);
  const commands = new Set(readdirSync(join(ROOT, 'lib/commands')).map((f) => `./${f}`));
  const imported = [...src.matchAll(STATIC)].map((m) => m[1]);
  assert.deepEqual(imported.filter((i) => commands.has(i) && !['./context.mjs', './prompter.mjs'].includes(i)), []);
});
