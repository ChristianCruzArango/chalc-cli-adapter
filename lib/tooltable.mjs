// lib/tooltable.mjs — la tabla de herramientas por lenguaje (spec 011, R1, R2, R7).
// Responsabilidad ÚNICA: cargar el catálogo de stacks y resolver uno contra un repo.
// Razón de cambio: el modelo de la tabla y de dónde salen sus hechos.
//
// Antes, esto que ahora son siete archivos de datos vivía como código en `lib/gatedetect.mjs` Y,
// otra vez, como prosa en `catalog/skills/mutation-testing/SKILL.md`. La spec 007 pidió en R20 que
// ambas coincidieran, pero R20 era una obligación dirigida a quien edita: se cumplía a mano, y a
// mano se rompía. Ahora hay una sola fila de la que nacen las dos.
//
// La carga es genérica a propósito: este módulo no conoce ninguno de los siete stacks. Si los
// conociera, el problema estaría movido de sitio y no resuelto — añadir un lenguaje volvería a ser
// tocar código (R3).

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS } from '../catalog/gate/lib/mutation.mjs';
import { resolve as resolveRule } from './toolrules.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

// La tabla vive en el catálogo, junto a lo demás que chalc proyecta al repo del usuario: skills,
// métodos, agentes, portón y advisor. El conocimiento de stacks es material, no lógica.
export const TOOLS_DIR = join(ROOT, 'catalog', 'tools');

// Los stacks declarados, ordenados por prioridad. Un archivo corrupto se descarta en vez de tumbar
// la carga: un lenguaje con una errata no puede dejar sin equipar a los otros seis.
export async function loadToolTable(dir = TOOLS_DIR) {
  let files;
  try { files = await readdir(dir); } catch { return []; }

  const stacks = [];
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    try { stacks.push(JSON.parse(await readFile(join(dir, file), 'utf8'))); } catch { /* errata: se salta */ }
  }
  return stacks.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));
}

// El stack de un repo: el primero cuyas señales de raíz encajan. `ctx` viene de `detectContext`, el
// mismo que usa el resto de chalc — las señales se miran en la RAÍZ, sin escanear en profundidad.
export function resolveStack(stacks, ctx) {
  return stacks.find((stack) =>
    (stack.detect?.files || []).some((name) => ctx.hasFile(name)) ||
    (stack.detect?.globs || []).some((pattern) => ctx.glob(pattern))) || null;
}

// Concatena las fuentes de texto que un stack declara, para que sus reglas `bySignal` busquen en
// ellas. Cuáles son es dato del stack, no conocimiento de este módulo.
async function readSignals(projectPath, stack) {
  const signals = {};
  for (const [name, sources] of Object.entries(stack.signals || {})) {
    const parts = [];
    for (const source of sources) {
      try { parts.push(await readFile(join(projectPath, source), 'utf8')); } catch { /* ausente o ilegible */ }
    }
    signals[name] = parts.join('\n');
  }
  return signals;
}

// Los JSON del repo que las reglas `jsonField` necesitan leer.
async function readJson(projectPath, stack) {
  const json = {};
  for (const rule of [stack.test, stack.mutation]) {
    if (rule?.rule !== 'jsonField' || json[rule.file]) continue;
    try { json[rule.file] = JSON.parse(await readFile(join(projectPath, rule.file), 'utf8')); } catch { json[rule.file] = null; }
  }
  return json;
}

// Aplica las reglas del stack a un repo. Devuelve { test, mutation }: `test` es cadena (vacía si no
// se pudo determinar) y `mutation` es el bloque o `null`.
//
// Un campo sin resolver queda vacío A PROPÓSITO (R2 de la spec 007): el portón lo marca como
// pendiente y bloquea. Un comando inventado se ve mucho peor — falla en silencio o, peor, aprueba.
export async function resolveTools(stack, projectPath, ctx) {
  const input = {
    json: await readJson(projectPath, stack),
    signals: await readSignals(projectPath, stack),
    deps: ctx.deps,
    entries: ctx.entries
  };

  const mutation = resolveRule(stack.mutation, input);
  return {
    test: resolveRule(stack.test, input) ?? '',
    mutation: mutation ? gateFieldsOf(mutation) : null
  };
}

// Campos que existen para la SKILL y no para el portón. `setup` es la prosa que explica cómo hacer
// que la herramienta escriba su reporte donde el portón lo lee; en `.chalc/gate.json` sería ruido —
// una clave que el portón no usa y que el usuario acabaría editando sin efecto.
const SKILL_ONLY = new Set(['setup']);

const gateFieldsOf = (mutation) =>
  Object.fromEntries(Object.entries(mutation).filter(([key]) => !SKILL_ONLY.has(key)));

// ¿Sabe el portón leer este formato de reporte? La verdad está en su registro de parsers, no en una
// copia. Cualquier lista aparte sería la tercera fuente que esta spec vino a quitar (R7).
export const parserFor = (format) => FORMATS.includes(format);
