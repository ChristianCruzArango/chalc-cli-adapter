// lib/verify-boundaries.mjs — linter de fronteras de arquitectura para `chalc verify`.
//
// La implementación vive en `catalog/gate/lib/boundaries.mjs`, dentro del portón de calidad, porque
// es el portón quien la ejecuta en cada tarea del repo equipado. Aquí solo se re-exporta: `chalc
// verify` y el portón comparten UNA implementación, y lo que se copia al repo no es una variante
// paralela que pueda quedarse atrás, sino el mismo archivo.

export { layerOf, extractImports, importsWithLines, lintBoundaries, lintBoundariesIn } from '../catalog/gate/lib/boundaries.mjs';
