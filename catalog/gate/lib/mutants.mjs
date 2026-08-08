// mutants.mjs — vocabulario común de los mutantes y cálculo del score. Responsabilidad ÚNICA:
// convertir una lista de mutantes ya normalizados en cifras y sobrevivientes. Razón de cambio: cómo
// se puntúa una corrida de mutación.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Cada parser (`report-elements`, `report-junit`, `report-pit`) traduce SU formato a estos estados y
// nada más. Así el score se calcula en UN solo sitio: si cada herramienta trajera su propia
// aritmética, el mismo repo daría cifras distintas según la herramienta y ninguna sería confiable.

// Detectado = el test cazó el mutante. No detectado = bug que nadie atrapa (sin cobertura cuenta:
// para el usuario es idéntico a un superviviente). Lo que no está en ninguno de los dos no es señal
// sobre la calidad de las pruebas y queda FUERA del denominador.
export const DETECTED = new Set(['Killed', 'Timeout']);
export const UNDETECTED = new Set(['Survived', 'NoCoverage']);

// Resume los mutantes en { score, killed, timeout, survived, noCoverage, total, survivors }.
// `score` es null cuando no hay ni un mutante válido: sin base no hay veredicto, y el llamador debe
// tratarlo como bloqueo en vez de dar por buena una cifra inventada.
export function summarize(mutants) {
  const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
  const survivors = [];

  for (const m of mutants) {
    const status = m?.status;
    if (!DETECTED.has(status) && !UNDETECTED.has(status)) continue;
    counts[status] += 1;
    if (UNDETECTED.has(status)) {
      survivors.push({ file: m.file || '', line: m.line ?? 0, mutator: m.mutator || '', status });
    }
  }

  const detected = counts.Killed + counts.Timeout;
  const total = detected + counts.Survived + counts.NoCoverage;
  // Orden estable por archivo y línea: el informe tiene que poder compararse entre corridas.
  survivors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  return {
    score: total ? Math.round((detected / total) * 10000) / 100 : null,
    killed: counts.Killed,
    timeout: counts.Timeout,
    survived: counts.Survived,
    noCoverage: counts.NoCoverage,
    total,
    survivors
  };
}
