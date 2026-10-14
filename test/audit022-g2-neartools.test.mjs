// T2 (spec 022, R19, C9) — cada heurística de resolución de tools desconocidas es una función propia,
// probada por separado; la composición conserva el comportamiento del loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  truncatedMcpNames, uniqueSuffixName, namespaceTailName, narrowByArgs, nearTools, unknownToolHint
} from '../cli/engine/neartools.mjs';

const NAMES = ['read', 'write', 'edit', 'bash', 'mcp__ng__get_best_practices', 'mcp__ng__list_projects', 'mcp__db__query'];
const TOOLS = Object.fromEntries(NAMES.map((n) => [n, {}]));
TOOLS.mcp__ng__get_best_practices.argHints = ['topic'];
TOOLS.mcp__ng__list_projects.argHints = ['workspace'];

test('T2 (spec 022, R19, C9): truncatedMcpNames — only MCP names, only prefixes of 4+ chars', () => {
  assert.deepEqual(truncatedMcpNames(NAMES, 'mcp__ng__get'), ['mcp__ng__get_best_practices']);
  assert.deepEqual(truncatedMcpNames(NAMES, 'mcp__ng'), ['mcp__ng__get_best_practices', 'mcp__ng__list_projects']);
  assert.deepEqual(truncatedMcpNames(NAMES, 'mcp'), [], 'menos de 4 caracteres');
  assert.deepEqual(truncatedMcpNames(NAMES, 'edit'), [], 'una tool local no se resuelve por prefijo');
  assert.deepEqual(truncatedMcpNames(NAMES, 'editor_x'), []);
});

test('T2 (spec 022, R19, C9): uniqueSuffixName — the bare tool name without the server prefix', () => {
  assert.deepEqual(uniqueSuffixName(NAMES, 'get_best_practices'), ['mcp__ng__get_best_practices']);
  assert.deepEqual(uniqueSuffixName(NAMES, 'abc'), [], 'menos de 4 caracteres');
  assert.deepEqual(uniqueSuffixName([...NAMES, 'mcp__other__query'], 'query'), [], 'ambiguo');
  assert.deepEqual(uniqueSuffixName(NAMES, 'query'), ['mcp__db__query']);
});

test('T2 (spec 022, R19, C9): namespaceTailName — invented namespace with dot or slash', () => {
  assert.deepEqual(namespaceTailName(NAMES, 'functions.write'), ['write']);
  assert.deepEqual(namespaceTailName(NAMES, 'repo_browser/read'), ['read']);
  assert.deepEqual(namespaceTailName(NAMES, 'container.exec'), []);
  assert.deepEqual(namespaceTailName(NAMES, 'write'), [], 'sin namespace no aplica');
});

test('T2 (spec 022, R19, C9): narrowByArgs — the args keys fit the schema of exactly one candidate', () => {
  const near = ['mcp__ng__get_best_practices', 'mcp__ng__list_projects'];
  assert.deepEqual(narrowByArgs(TOOLS, near, { topic: 'x' }), ['mcp__ng__get_best_practices']);
  assert.deepEqual(narrowByArgs(TOOLS, near, {}), near, 'sin args no se puede decidir');
  assert.deepEqual(narrowByArgs(TOOLS, near, { other: 1 }), near, 'ninguna encaja');
  assert.deepEqual(narrowByArgs(TOOLS, near, undefined), near);
});

test('T2 (spec 022, R19, C9): nearTools composes the heuristics in order', () => {
  assert.deepEqual(nearTools(TOOLS, { tool: 'mcp__ng__get' }), ['mcp__ng__get_best_practices']);
  assert.deepEqual(nearTools(TOOLS, { tool: 'get_best_practices' }), ['mcp__ng__get_best_practices']);
  assert.deepEqual(nearTools(TOOLS, { tool: 'functions.write' }), ['write']);
  assert.deepEqual(nearTools(TOOLS, { tool: 'mcp__ng', args: { workspace: 'a' } }), ['mcp__ng__list_projects']);
  assert.deepEqual(nearTools(TOOLS, { tool: 'mcp__ng' }).length, 2);
  assert.deepEqual(nearTools(TOOLS, { tool: 'sh' }), []);
});

test('T2 (spec 022, R19, C9): unknownToolHint — incomplete name, read-only role, missing tool', () => {
  assert.match(unknownToolHint(TOOLS, 'mcp__ng', ['mcp__ng__list_projects']), /FULL exact name, e\.g\. "mcp__ng__list_projects"/);
  const readOnly = { read: {}, list: {}, grep: {} };
  assert.match(unknownToolHint(readOnly, 'write', []), /READ-ONLY role/);
  assert.match(unknownToolHint(readOnly, 'deploy', []), /does NOT exist: pick EXACTLY one from "available"$/);
  assert.match(unknownToolHint(TOOLS, 'deploy', []), /or do it with write\/edit\/bash$/);
  assert.match(unknownToolHint(TOOLS, 'write', []), /does NOT exist/, 'con write disponible no es un rol de solo lectura');
});

test('T2 (spec 022, R19, C9): the loop no longer carries the heuristics inline', () => {
  const src = readFileSync(new URL('../cli/engine/loop.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /function nearTools/);
  assert.match(src, /from '\.\/neartools\.mjs'/);
});
