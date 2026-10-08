// report-mutmut.mjs — parser de `mutants/mutmut-cicd-stats.json`, lo que exporta mutmut 3.x con
// `mutmut export-cicd-stats`. Responsabilidad ÚNICA: traducir esos recuentos al resumen común.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// mutmut 3 ya no tiene `junitxml` (el comando que el portón usaba con la 2.x), y su única exportación
// es este JSON de recuentos: no dice en qué archivo ni en qué línea vive cada superviviente. Por eso
// el score es del conjunto mutado y no se puede acotar por línea; el informe lo muestra como un solo
// hallazgo agregado. A cambio, mutmut 3 muta una COPIA en `mutants/`: matar la corrida a mitad ya no
// deja los fuentes del repo mutados, como pasaba con la 2.x.

import { summarize } from './mutants.mjs';
import { ReportError } from './report-error.mjs';

const count = (raw, key) => (Number.isFinite(Number(raw[key])) ? Math.max(0, Math.trunc(Number(raw[key]))) : 0);

export function parseMutmutStats(text) {
  let raw;
  try { raw = JSON.parse(String(text)); } catch { throw new ReportError('notJson'); }
  if (!raw || typeof raw !== 'object' || !('killed' in raw) || !('survived' in raw)) {
    throw new ReportError('mutmutNoCounts');
  }
  if (raw.check_was_interrupted_by_user) throw new ReportError('mutmutInterrupted');

  // Los mismos estados que el resto de parsers: así el score se calcula en un solo sitio.
  const mutants = [
    ...Array(count(raw, 'killed') + count(raw, 'segfault')).fill({ status: 'Killed' }),
    ...Array(count(raw, 'timeout')).fill({ status: 'Timeout' }),
    ...Array(count(raw, 'survived')).fill({ status: 'Survived' }),
    ...Array(count(raw, 'no_tests')).fill({ status: 'NoCoverage' })
  ];
  return { ...summarize(mutants), survivors: [], aggregate: true };
}
