// T12 (R2) — el conocimiento de stack ya no vive en el código de detección.
//
// Una refactorización de "dónde vive el conocimiento" se deshace sola con el tiempo: llega un stack
// raro, alguien mete un `if` en el detector "solo por esta vez", y en seis meses hay otra vez dos
// fuentes que no coinciden. Ese es exactamente el estado del que la spec 011 viene saliendo.
//
// Este test lo impide de la única forma que funciona: cruzando el contenido REAL de la tabla contra
// el código. Si mañana alguien escribe `mvn test` en `gatedetect.mjs`, se pone rojo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToolTable } from '../lib/tooltable.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const source = (rel) => readFile(join(ROOT, rel), 'utf8');

// Todas las cadenas "de stack" que la tabla declara: comandos, rutas de reporte, instalaciones,
// herramientas y sondas. Ninguna puede aparecer en el código.
async function stackStrings() {
  const found = new Set();
  const collect = (block) => {
    if (!block) return;
    for (const key of ['tool', 'command', 'report', 'install', 'probe']) {
      if (block[key]) found.add(block[key]);
    }
  };

  for (const stack of await loadToolTable()) {
    if (typeof stack.test?.value === 'string' && stack.test.value) found.add(stack.test.value);
    for (const c of stack.test?.cases || []) if (typeof c.value === 'string' && c.value) found.add(c.value);

    collect(stack.mutation?.value);
    collect(stack.mutation?.base);
    for (const c of stack.mutation?.cases || []) collect(c.value);
    for (const t of Object.values(stack.mutation?.template || {})) found.add(t);
  }
  return [...found];
}

test('R2 — el detector no contiene ningún comando, ruta ni herramienta de la tabla', async () => {
  const code = await source('lib/gatedetect.mjs');

  for (const literal of await stackStrings()) {
    assert.ok(!code.includes(literal), `lib/gatedetect.mjs sigue conociendo "${literal}"`);
  }
});

test('R2 — el detector tampoco nombra los stacks uno a uno', async () => {
  const code = await source('lib/gatedetect.mjs');

  for (const stack of await loadToolTable()) {
    assert.ok(!new RegExp(`['"\`]${stack.id}['"\`]`).test(code), `gatedetect nombra el stack "${stack.id}"`);
  }
});

test('R2 — el detector ya no lee archivos de ecosistemas concretos', async () => {
  const code = await source('lib/gatedetect.mjs');

  for (const file of ['package.json', 'pubspec.yaml', 'pyproject.toml', 'requirements.txt', 'setup.cfg', 'pom.xml', 'Cargo.toml', 'composer.json']) {
    assert.ok(!code.includes(file), `gatedetect sigue leyendo "${file}" a mano`);
  }
});

// Lo que SÍ debe seguir aquí: no todo lo que hay en `gate.json` es conocimiento de stack.
test('R2 — el detector conserva lo que no es de stack: umbrales, specs y puertas', async () => {
  const code = await source('lib/gatedetect.mjs');

  assert.match(code, /maxFileLines/, 'los umbrales del linter no son conocimiento de stack');
  assert.match(code, /threshold/, 'el umbral de mutación tampoco');
  assert.match(code, /approvals/, 'las puertas del advisor tampoco');
});

test('R2 — el módulo de la tabla tampoco conoce los stacks: la carga es genérica', async () => {
  const code = await source('lib/tooltable.mjs');

  for (const stack of await loadToolTable()) {
    assert.ok(!new RegExp(`['"\`]${stack.id}['"\`]`).test(code), `tooltable nombra el stack "${stack.id}"`);
  }
  for (const literal of await stackStrings()) {
    assert.ok(!code.includes(literal), `tooltable conoce "${literal}"`);
  }
});

test('R4 — las reglas tampoco conocen ningún stack', async () => {
  const code = await source('lib/toolrules.mjs');

  for (const stack of await loadToolTable()) {
    assert.ok(!new RegExp(`['"\`]${stack.id}['"\`]`).test(code), `toolrules nombra el stack "${stack.id}"`);
  }
});
