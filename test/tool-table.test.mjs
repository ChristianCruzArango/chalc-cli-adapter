// T7–T10 (R1, R3, R7, R12) — la tabla de herramientas como catálogo de datos.
//
// El objetivo de la spec 011 es que añadir un lenguaje sea añadir un archivo. Eso solo es cierto si
// la carga es genérica de verdad: si el cargador conociera los siete stacks de hoy, habríamos movido
// el problema de sitio en vez de resolverlo. Por eso T9 carga un directorio con un stack inventado.
//
// Y la tabla son DATOS (R12): siete archivos que se leen con `JSON.parse`, sin nada ejecutable. Un
// `.mjs` con lógica dentro sería el primer paso de vuelta al código disperso.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadToolTable, parserFor, resolveStack, resolveTools, TOOLS_DIR } from '../lib/tooltable.mjs';
import { RULE_NAMES } from '../lib/toolrules.mjs';
import { detectContext } from '../lib/detect.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-tools-table-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

// ── T7: la forma de la tabla ──────────────────────────────────────────────────────────────────

test('R1 — todo stack declara id, label, priority y cómo se detecta', async () => {
  for (const stack of await loadToolTable()) {
    assert.match(stack.id, /^[a-z][a-z0-9-]*$/, `${stack.id}: el id acaba en gate.json, debe ser estable`);
    assert.ok(stack.label, `${stack.id}: falta label, lo usa la tabla de la skill`);
    assert.equal(typeof stack.priority, 'number', `${stack.id}: falta priority`);
    assert.ok(
      (stack.detect?.files || []).length || (stack.detect?.globs || []).length,
      `${stack.id}: sin señales de detección nunca se elegiría`
    );
  }
});

test('R1 — las prioridades son únicas: el orden no puede depender de readdir', async () => {
  const priorities = (await loadToolTable()).map((s) => s.priority);
  assert.equal(new Set(priorities).size, priorities.length);
});

test('R1 — toda regla declarada existe de verdad', async () => {
  for (const stack of await loadToolTable()) {
    for (const [field, rule] of [['test', stack.test], ['mutation', stack.mutation]]) {
      if (!rule) continue;
      assert.ok(RULE_NAMES.includes(rule.rule), `${stack.id}.${field}: regla desconocida "${rule.rule}"`);
    }
  }
});

test('R1 — toda señal usada por una regla está declarada en el stack', async () => {
  for (const stack of await loadToolTable()) {
    for (const rule of [stack.test, stack.mutation]) {
      if (rule?.rule !== 'bySignal') continue;
      assert.ok(stack.signals?.[rule.signal], `${stack.id}: usa la señal "${rule.signal}" sin declarar sus archivos`);
    }
  }
});

test('R12 — la tabla son datos: solo .json, y todos parsean', async () => {
  const files = await readdir(TOOLS_DIR);
  assert.ok(files.length, 'la tabla no puede estar vacía');

  for (const file of files) {
    assert.match(file, /\.json$/, `${file}: la tabla no admite código, solo datos`);
    await assert.doesNotReject(
      async () => JSON.parse(await readFile(join(TOOLS_DIR, file), 'utf8')),
      `${file} no es JSON válido`
    );
  }
});

test('R12 — las expresiones regulares de la tabla compilan', async () => {
  // Un escape mal puesto en JSON no revienta: hace que la variante no se detecte y el stack quede
  // pendiente. Falla del lado seguro, pero en silencio — así que se comprueba aquí.
  for (const stack of await loadToolTable()) {
    for (const variant of stack.mutation?.variants || []) {
      if (variant.files) assert.doesNotThrow(() => new RegExp(variant.files), `${stack.id}/${variant.id}: regex inválida`);
    }
    for (const rule of [stack.test, stack.mutation]) {
      for (const c of rule?.cases || []) {
        assert.doesNotThrow(() => new RegExp(c.match), `${stack.id}: caso con regex inválida`);
      }
    }
  }
});

// ── T8: la carga y la resolución del stack ────────────────────────────────────────────────────

test('R1 — la tabla se carga ordenada por priority', async () => {
  const priorities = (await loadToolTable()).map((s) => s.priority);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b));
});

test('R11 — resolveStack elige por señales de raíz', async () => {
  const stacks = await loadToolTable();
  const of = async (files) => resolveStack(stacks, await detectContext(await project(files)))?.id ?? '';

  assert.equal(await of({ 'package.json': { name: 'a' } }), 'js');
  assert.equal(await of({ 'App.csproj': '<Project/>' }), 'dotnet');
  assert.equal(await of({ 'pubspec.yaml': 'name: a\n' }), 'dart');
  assert.equal(await of({ 'pom.xml': '<project/>' }), 'maven');
  assert.equal(await of({ 'Cargo.toml': '[package]\n' }), 'rust');
  assert.equal(await of({ 'composer.json': { name: 'a/a' } }), 'php');
  assert.equal(await of({ 'LEEME.txt': 'hola' }), '');
});

test('R11 — con varias señales gana la priority más baja', async () => {
  const stacks = await loadToolTable();
  const ctx = await detectContext(await project({ 'package.json': { name: 'a' }, 'pom.xml': '<project/>' }));

  assert.equal(resolveStack(stacks, ctx).id, 'js');
});

// ── T9: añadir un stack es añadir un archivo ──────────────────────────────────────────────────

test('R3 — un stack que el código nunca vio se carga y resuelve igual', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-tools-fake-'));
  await writeFile(join(dir, 'elixir.json'), JSON.stringify({
    id: 'elixir', label: 'Elixir', priority: 5,
    detect: { files: ['mix.exs'] },
    test: { rule: 'fixed', value: 'mix test' },
    mutation: { rule: 'fixed', value: { tool: 'muzak', command: 'mix muzak', report: 'muzak.json', format: 'elements', install: '', probe: '', scopeFlag: '' } }
  }, null, 2), 'utf8');

  const stacks = await loadToolTable(dir);
  const repo = await project({ 'mix.exs': 'defmodule Demo.MixProject do\nend\n' });
  const ctx = await detectContext(repo);
  const stack = resolveStack(stacks, ctx);

  assert.equal(stack.id, 'elixir');
  const tools = await resolveTools(stack, repo, ctx);
  assert.equal(tools.test, 'mix test');
  assert.equal(tools.mutation.tool, 'muzak');
});

test('R3 — un archivo corrupto en la tabla no tumba la carga entera', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-tools-roto-'));
  await writeFile(join(dir, 'roto.json'), '{ esto no es json', 'utf8');
  await writeFile(join(dir, 'bueno.json'), JSON.stringify({
    id: 'bueno', label: 'Bueno', priority: 1, detect: { files: ['x.toml'] },
    test: { rule: 'fixed', value: 'echo' }, mutation: null
  }), 'utf8');

  const stacks = await loadToolTable(dir);
  assert.deepEqual(stacks.map((s) => s.id), ['bueno']);
});

// ── T10: quién decide si el portón puede verificar ────────────────────────────────────────────

test('R7 — parserFor sale del registro real del portón, no de una lista aparte', async () => {
  assert.equal(parserFor('elements'), true);
  assert.equal(parserFor('junit'), true);
  assert.equal(parserFor('pit'), true);
});

test('R7 — un formato vacío o desconocido no tiene parser', () => {
  assert.equal(parserFor(''), false);
  assert.equal(parserFor('gremlins'), false);
  assert.equal(parserFor(undefined), false);
});

test('R7 — los stacks sin parser salen de cruzar la tabla con el portón, no de una lista escrita', async () => {
  const unparsed = (await loadToolTable())
    .filter((s) => !parserFor(s.mutation?.rule === 'fixed' ? s.mutation.value?.format : formatOf(s)))
    .map((s) => s.id);

  // Hoy: Dart, Rust y PHP. Si mañana se añade un parser, esta lista cambia sola.
  assert.deepEqual(unparsed.sort(), ['dart', 'php', 'rust']);
});

// El formato declarado por un stack, mirando donde su regla lo ponga.
function formatOf(stack) {
  const rule = stack.mutation;
  if (!rule) return '';
  if (rule.rule === 'fixed') return rule.value?.format || '';
  if (rule.rule === 'byLookup') return rule.base?.format || '';
  if (rule.rule === 'bySignal') return rule.cases?.[0]?.value?.format || '';
  return '';
}

test('R1 — la tabla vive en el catálogo, junto al resto de lo que se proyecta al repo', () => {
  assert.equal(TOOLS_DIR, join(ROOT, 'catalog', 'tools'));
});
