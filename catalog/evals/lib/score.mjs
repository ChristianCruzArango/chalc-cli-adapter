// score.mjs — la puntuación de un eval (spec 042, R4, R5). Responsabilidad ÚNICA: sumar lo que dieron las
// comprobaciones y comparar corridas. Razón de cambio: cómo se cuenta.
//
// Este archivo lo emite chalc dentro de `.chalc/evals/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO. Lo omitido no cuenta ni a favor ni en contra: el máximo es el de lo que se pudo comprobar.

/** { earned, max, percent, skipped } de los resultados de `runChecks`. */
export function totalOf(results) {
  const counted = results.filter((r) => r.status !== 'skipped');
  const earned = counted.reduce((sum, r) => sum + r.earned, 0);
  const max = counted.reduce((sum, r) => sum + r.points, 0);
  return { earned, max, percent: max ? Math.round((earned / max) * 100) : 0, skipped: results.length - counted.length };
}

/** Por etiqueta y caso: cuántas corridas y su media (en %), ordenado. runs: [{ label, case, percent }]. */
export function compare(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = `${run.label || ''}\n${run.case}`;
    groups.set(key, [...(groups.get(key) || []), run.percent]);
  }
  return [...groups].map(([key, percents]) => {
    const [label, id] = key.split('\n');
    return { label, case: id, runs: percents.length, average: Math.round(percents.reduce((sum, p) => sum + p, 0) / percents.length) };
  }).sort((a, b) => a.label.localeCompare(b.label) || a.case.localeCompare(b.case));
}
