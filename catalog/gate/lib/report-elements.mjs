// report-elements.mjs — parser del esquema `mutation-testing-elements`, el JSON que escriben
// Stryker (JS/TS) y Stryker.NET. Responsabilidad ÚNICA: traducir ese reporte a mutantes normalizados.
// Razón de cambio: el esquema del reporte.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// El score sale SIEMPRE del archivo de reporte, nunca del stdout de la herramienta ni de un resumen
// escrito por un asistente. Si el shape no encaja, se lanza: un 0 se leería como "tests malísimos"
// cuando lo que pasa es que el reporte es inservible, y esa confusión es justo la que abre la puerta
// a aprobar sin evidencia.

import { summarize } from './mutants.mjs';

// Todos los mutantes del reporte, aplanados con su archivo. Tolera entradas sin `mutants`.
// Los estados del esquema ya son el vocabulario común, así que no hay traducción que hacer.
function flatten(files) {
  const all = [];
  for (const [file, entry] of Object.entries(files)) {
    for (const m of entry?.mutants || []) {
      all.push({ file, line: m?.location?.start?.line ?? 0, mutator: m?.mutatorName || '', status: m?.status });
    }
  }
  return all;
}

// Parsea el texto del reporte. Misma salida que `parseJUnit` y `parsePit`.
export function parseElements(text) {
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('mutation report: JSON inválido'); }
  if (!json || typeof json.files !== 'object' || json.files === null) {
    throw new Error('mutation report: falta la sección "files" del esquema mutation-testing-elements');
  }

  return summarize(flatten(json.files));
}
