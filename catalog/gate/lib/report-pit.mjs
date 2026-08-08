// report-pit.mjs — parser del `mutations.xml` de PIT (Java/Kotlin, Maven o Gradle).
// Responsabilidad ÚNICA: traducir ese XML a mutantes normalizados. Razón de cambio: el formato de PIT.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.

import { elements, childText } from './xml.mjs';
import { summarize } from './mutants.mjs';

// Estados de PIT que sí hablan de la calidad de las pruebas. NON_VIABLE, MEMORY_ERROR y RUN_ERROR
// se omiten: son mutantes que no llegaron a ejecutarse, no tests flojos.
const STATUS = {
  KILLED: 'Killed',
  TIMED_OUT: 'Timeout',
  SURVIVED: 'Survived',
  NO_COVERAGE: 'NoCoverage'
};

// Ruta del fuente a partir del paquete de la clase mutada. PIT solo da el nombre del archivo, así
// que dos `Precio.java` en paquetes distintos serían indistinguibles en el informe. El sufijo `$Inner`
// de las clases anidadas no es parte del paquete.
function sourcePath(mutatedClass, sourceFile) {
  const cls = (mutatedClass || '').split('$')[0];
  const dot = cls.lastIndexOf('.');
  if (dot < 0) return sourceFile;
  return `${cls.slice(0, dot).replace(/\./g, '/')}/${sourceFile}`;
}

// PIT nombra el mutador con su clase completa; en el informe solo sirve la última parte.
const shortMutator = (mutator) => mutator.slice(mutator.lastIndexOf('.') + 1);

// Parsea el texto del reporte. Misma salida que `parseElements` y `parseJUnit`.
export function parsePit(text) {
  if (!/<mutations\b/.test(text)) {
    throw new Error('mutation report: falta <mutations>, el archivo no es un reporte de PIT');
  }

  const mutants = [];
  for (const { attrs, inner } of elements(text, 'mutation')) {
    const status = STATUS[(attrs.status || childText(inner, 'status')).toUpperCase()];
    if (!status) continue;
    mutants.push({
      file: sourcePath(childText(inner, 'mutatedClass'), childText(inner, 'sourceFile')),
      line: Number(childText(inner, 'lineNumber')) || 0,
      mutator: shortMutator(childText(inner, 'mutator')),
      status
    });
  }
  return summarize(mutants);
}
