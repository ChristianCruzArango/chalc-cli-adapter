// lib/contractlint.mjs — lint de contratos entre HUs de una corrida (spec 005, R7).
//
// La implementación vive en `catalog/gate/lib/contract-routes.mjs`, dentro del portón de calidad,
// porque es el portón quien comprueba el contrato en cada tarea del repo equipado. Aquí solo se
// re-exporta: el orquestador full-stack y el portón comparten UNA implementación.

export { contractRoutes, contractRoutesWithLines, findDuplicateRoutes } from '../catalog/gate/lib/contract-routes.mjs';
