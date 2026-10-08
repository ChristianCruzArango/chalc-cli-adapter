// state.mjs — el estado que deja el portón (spec 008, R13). Responsabilidad ÚNICA: leer
// `.chalc/gate.state.json`. Razón de cambio: el esquema de ese estado.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Por qué existe este archivo y no se parsea `.chalc/gate.md`: la evidencia está escrita para
// humanos y en el idioma del spec — el veredicto es un encabezado localizado y el aviso de `--fast`
// una frase traducida. Atar el advisor a esas dos redacciones lo rompería con cada retoque de
// estilo del informe. El portón escribe los dos artefactos desde el mismo cálculo: uno para leer,
// otro para decidir.
//
// Todos los defaults van hacia el lado seguro: lo que no se entiende NO aprueba y NO cierra tarea.
// Un estado de una versión anterior de chalc puede no traer `fast`, y asumirlo `false` cerraría
// tareas con corridas que jamás midieron mutación.

import { isPlainObject } from '../../gate/lib/data.mjs';

const NONE = { exists: false, date: 0, verdict: 'unknown', fast: true, closesTask: false, branch: '', spec: '', role: '', failedStages: [], suppressions: [], head: '', scopeHash: '', scopeFiles: [], configChanges: [] };

// Holgura para relojes desfasados. Una evidencia fechada más allá es inventada: con una fecha futura
// valía para siempre, porque ningún cambio posterior parecía «más nuevo» que ella.
export const FUTURE_SKEW_MS = 5 * 60 * 1000;

const VERDICTS = new Set(['pass', 'fail', 'blocked']);


// Hechos del portón a partir del texto de `.chalc/gate.state.json`. Ausente, corrupto o sin fecha
// usable → no hay evidencia (que no es lo mismo que una evidencia que falla).
export function parseGateState(text, { now = Date.now() } = {}) {
  let raw;
  try { raw = JSON.parse(String(text ?? '')); } catch { return { ...NONE }; }
  if (!isPlainObject(raw)) return { ...NONE };

  const date = Date.parse(raw.date);
  if (!Number.isFinite(date)) return { ...NONE };
  if (date > now + FUTURE_SKEW_MS) return { ...NONE, future: true };

  return {
    exists: true,
    date,
    verdict: VERDICTS.has(raw.verdict) ? raw.verdict : 'unknown',
    fast: raw.fast !== false,
    closesTask: raw.closesTask === true,
    branch: String(raw.branch ?? ''),
    spec: String(raw.spec ?? ''),
    role: String(raw.role ?? ''),
    failedStages: failedStagesOf(raw.stages),
    suppressions: suppressionsOf(raw.suppressions),
    head: String(raw.head ?? ''),
    scopeHash: String(raw.scopeHash ?? ''),
    scopeFiles: Array.isArray(raw.scope?.files) ? raw.scope.files.map(String) : [],
    configChanges: Array.isArray(raw.configChanges) ? raw.configChanges.map(String) : []
  };
}

// Las supresiones aceptadas por el portón (spec 015, R13). Una entrada sin regla o sin archivo no
// dice qué se aceptó, y no se toma.
const suppressionsOf = (list) => (Array.isArray(list) ? list : [])
  .filter((s) => isPlainObject(s) && s.rule && s.file)
  .map(({ file, line, rule, reason }) => ({ file: String(file), line: Number(line) || 0, rule: String(rule), reason: String(reason ?? '') }));

// Las etapas que corrieron y no pasaron (spec 014, R22). Con ellas el motivo de `fix_gate` puede decir
// QUÉ arreglar primero; un estado de una versión anterior, sin etapas, no tiene ninguna.
const failedStagesOf = (stages) => (Array.isArray(stages) ? stages : [])
  .filter((s) => isPlainObject(s) && !s.ok && !s.skipped)
  .map((s) => String(s.stage ?? ''));
