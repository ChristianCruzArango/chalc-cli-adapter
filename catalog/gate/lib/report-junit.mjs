// report-junit.mjs — parser del JUnit XML que escribe `mutmut junitxml`. Responsabilidad ÚNICA:
// traducir ese XML a mutantes normalizados. Razón de cambio: el formato de mutmut.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// mutmut emite un <testcase> por mutante y codifica el desenlace en el hijo, no en un atributo.

import { elements } from './xml.mjs';
import { summarize } from './mutants.mjs';

// `ruta:línea:` al inicio del nombre del caso, para las versiones de mutmut que no ponen los
// atributos file/line. Codicioso a propósito: así una ruta con `C:\…` no se parte por el primer `:`.
const NAME_LOCATION = /^(.*):(\d+)(?::|$)/;

// Desenlace de un mutante según el hijo del <testcase>. null = fuera del denominador.
function statusOf(inner) {
  if (inner === null || !inner.trim()) return 'Killed';        // auto-cerrado: el test lo cazó
  if (/<skipped\b/.test(inner)) return null;                   // saltado por política, como Ignored
  if (/<failure\b/.test(inner)) return 'Survived';
  // <error> agrupa "sospechoso" (timeout) y "sin cobertura", y el XML no los distingue. Se cuenta
  // como NO detectado: pasarse de estricto bloquea, pasarse de laxo aprueba sin evidencia.
  if (/<error\b/.test(inner)) return 'NoCoverage';
  return 'Killed';
}

// Archivo y línea del mutante: atributos si están, si no el nombre del caso.
function locationOf(attrs) {
  const fromName = NAME_LOCATION.exec(attrs.name || '');
  return {
    file: attrs.file || fromName?.[1] || '',
    line: Number(attrs.line) || Number(fromName?.[2]) || 0
  };
}

// Parsea el texto del reporte. Misma salida que `parseElements` y `parsePit`.
export function parseJUnit(text, opts = {}) {
  if (!/<testsuite\b/.test(text)) {
    throw new Error('mutation report: falta <testsuite>, el archivo no es un reporte junit');
  }

  const mutants = [];
  for (const { attrs, inner } of elements(text, 'testcase')) {
    const status = statusOf(inner);
    if (!status) continue;
    // mutmut no dice qué mutador aplicó: el campo va vacío en vez de inventarse un nombre.
    mutants.push({ ...locationOf(attrs), mutator: '', status });
  }
  return summarize(mutants, opts);
}
