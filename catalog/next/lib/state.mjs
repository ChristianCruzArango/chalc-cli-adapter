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

const NONE = { exists: false, date: 0, verdict: 'unknown', fast: true, closesTask: false, branch: '', spec: '', role: '' };

const VERDICTS = new Set(['pass', 'fail', 'blocked']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Hechos del portón a partir del texto de `.chalc/gate.state.json`. Ausente, corrupto o sin fecha
// usable → no hay evidencia (que no es lo mismo que una evidencia que falla).
export function parseGateState(text) {
  let raw;
  try { raw = JSON.parse(String(text ?? '')); } catch { return { ...NONE }; }
  if (!isPlainObject(raw)) return { ...NONE };

  const date = Date.parse(raw.date);
  if (!Number.isFinite(date)) return { ...NONE };

  return {
    exists: true,
    date,
    verdict: VERDICTS.has(raw.verdict) ? raw.verdict : 'unknown',
    fast: raw.fast !== false,
    closesTask: raw.closesTask === true,
    branch: String(raw.branch ?? ''),
    spec: String(raw.spec ?? ''),
    role: String(raw.role ?? '')
  };
}
