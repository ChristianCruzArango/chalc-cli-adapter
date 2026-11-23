// test/helpers/readyspecs.mjs — los hechos de una spec coherente y aprobada, para los snapshots escritos a
// mano de los tests del advisor (spec 024). Responsabilidad ÚNICA: que un test que prueba OTRA fila de la
// tabla no tenga que describir la coherencia, que va antes que todas.

export const READY_FINGERPRINT = 'f'.repeat(16);

/** `specs` de un snapshot cuya carpeta activa no tiene problemas y está aprobada por el usuario. */
export const READY_SPECS = Object.freeze({
  dir: 'specs/001-demo', problem: '', pinned: false, problems: Object.freeze([]), fingerprint: READY_FINGERPRINT, approved: true, sealDate: 0
});

/** `closing` de un snapshot cuyo cierre aprobó el usuario para la evidencia del portón fechada en `gateDate` (spec 028). */
export const closedFor = (gateDate) => ({ fingerprint: READY_FINGERPRINT, evidence: gateDate });
