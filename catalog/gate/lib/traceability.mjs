// traceability.mjs — cada test cambiado cita un requisito que EXISTE en la spec (R7).
// Responsabilidad ÚNICA: cruzar las citas `R#` de los tests con los requisitos declarados.
// Razón de cambio: cómo se identifican requisitos y archivos de test.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Es la regla que sostiene el método: si un test no dice qué requisito cubre, nadie puede saber si
// la spec quedó implementada y "todo verde" deja de significar nada. Y citar un `R#` inventado es
// peor que no citar ninguno — parece trazado y no lo está.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newestSpec } from './spec.mjs';
import { RULES } from './rules.mjs';

// Cómo nombra cada stack a sus pruebas. Un archivo que no es test no tiene nada que trazar.
const TEST_FILE = /(?:\.spec\.|\.test\.|_test\.|_spec\.|(?:^|\/)test_[^/]*\.py$|Tests?\.(?:cs|java|kt)$|(?:^|\/)(?:tests?|__tests__)\/)/;

// Requisito declarado en la spec: `- **R1** — WHEN … THE SYSTEM SHALL …`.
const DECLARED = /\*\*(R\d+)\*\*/g;

// Cualquier mención a un requisito.
const MENTION = /\bR\d+\b/g;

// Los requisitos que la spec DECLARA. Si no hay ninguno en negrita — una spec escrita a mano puede
// no usarlas — se toma cualquier mención: comprobar de menos es mejor que no comprobar nada.
export function requirementsOf(text) {
  const declared = new Set([...String(text).matchAll(DECLARED)].map((m) => m[1]));
  if (declared.size) return declared;
  return new Set([...String(text).matchAll(MENTION)].map((m) => m[0]));
}

const finding = (file, line, rule, data = {}) => ({ file, line, rule, data });

// Comprueba la trazabilidad de los tests cambiados. `files` son rutas relativas a `root`.
// Sin spec en el repo devuelve vacío: R7 es condicional, y sin requisitos no hay contra qué trazar.
export async function checkTraceability(files, { root, specDir = 'specs' } = {}) {
  const tests = files.filter((f) => TEST_FILE.test(f.replace(/\\/g, '/')));
  if (!tests.length) return [];

  const spec = await newestSpec(root, specDir, 'spec.md');
  if (!spec) return [];
  const requirements = requirementsOf(spec.text);

  const found = [];
  for (const file of tests) {
    let text;
    try { text = await readFile(join(root, file), 'utf8'); } catch { continue; }   // borrado en la tarea

    const cited = [...text.matchAll(MENTION)]
      .map((m) => ({ id: m[0], line: text.slice(0, m.index).split('\n').length }));

    if (!cited.length) {
      found.push(finding(file, 1, RULES.noRequirement, { spec: spec.path }));
      continue;
    }

    // Una cita inventada se reporta aunque el test cite también una válida: parece trazado y no lo está.
    for (const { id, line } of cited) {
      if (!requirements.has(id)) found.push(finding(file, line, RULES.unknownRequirement, { id, spec: spec.path }));
    }
  }
  return found;
}
