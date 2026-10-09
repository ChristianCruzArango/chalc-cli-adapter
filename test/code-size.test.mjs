// M-01 — chalc cumple las reglas de tamaño que su propio portón exige a los proyectos que equipa
// (funciones ≤ 40 líneas, archivos ≤ 300), medidas con el MISMO linter del portón.
//
// Hubo una lista de excepciones que solo podía encoger; llegó a vacía y se retiró: desde entonces no
// hay excepciones, y una función o un archivo por encima del límite rompe la suite. Parámetros y
// profundidad (M-02) se exigen abajo, con su propia lista de excepciones justificadas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintSource } from '../catalog/gate/lib/smells.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['bin', 'cli', 'lib', 'targets', 'catalog/gate', 'catalog/next', 'catalog/memory', 'catalog/mail'];
const LIMITS = { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3 };

async function* sources(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (p.endsWith('.mjs')) yield p;
  }
}

async function measure() {
  const found = {};
  for (const dir of DIRS) {
    for await (const file of sources(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      for (const f of lintSource(await readFile(file, 'utf8'), { file: rel, limits: LIMITS })) {
        if (f.rule === 'file-too-long') found[rel] = f.data.lines;
        if (f.rule === 'function-too-long') found[`${rel}::${f.data.name}`] = Math.max(found[`${rel}::${f.data.name}`] || 0, f.data.lines);
      }
    }
  }
  return found;
}

test('no function or file exceeds the gate size limits', async () => {
  assert.deepEqual(await measure(), {}, 'funciones o archivos por encima del límite: pártelos en piezas con una responsabilidad');
});

// ── M-02 (spec 016, R29): parámetros y profundidad ─────────────────────────────────────────────────
//
// El test pasaba maxParams y maxDepth al linter pero solo exigía tamaño. Ahora se exigen también, con
// una lista de excepciones VERIFICABLE: cada entrada lleva su motivo y la lista solo puede encoger —si
// una deja de darse, el test pide quitarla—. Una violación nueva rompe la suite.
// Clave: `regla archivo::nombre/valor` (sin línea: editar más arriba no debe romper nada; con el valor
// medido —parámetros o profundidad—: una firma registrada que CRECE también rompe) → [veces, motivo].
// Vacía desde T38 (spec 016, R38): la deuda se saldó y el linter ya no mide llamadas como funciones.
// Una excepción nueva necesita un motivo de al menos tres palabras.
const RULE_EXCEPTIONS = {};

async function measureRules() {
  const found = {};
  for (const dir of DIRS) {
    for await (const file of sources(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      for (const f of lintSource(await readFile(file, 'utf8'), { file: rel, limits: LIMITS })) {
        if (f.rule !== 'too-many-params' && f.rule !== 'deep-nesting') continue;
        const key = `${f.rule} ${rel}::${f.data.name}/${f.data.params ?? f.data.depth}`;
        found[key] = (found[key] || 0) + 1;
      }
    }
  }
  return found;
}

test('R29: parameter and nesting limits are enforced; every exception is registered with a reason', async () => {
  const expected = Object.fromEntries(Object.entries(RULE_EXCEPTIONS).map(([key, [times]]) => [key, times]));
  assert.deepEqual(await measureRules(), expected);
  for (const [key, [, reason]] of Object.entries(RULE_EXCEPTIONS)) assert.ok(String(reason).trim().split(/\s+/).length >= 3, `${key}: el motivo no explica nada`);
});
