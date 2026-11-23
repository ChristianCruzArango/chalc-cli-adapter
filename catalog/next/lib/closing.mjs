// closing.mjs — el cierre de la feature en el advisor (spec 028, R1, R4, R5). Responsabilidad ÚNICA: decir si el
// usuario ya aprobó ESTE cierre. Razón de cambio: a qué se ata una aprobación de cierre.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// PURO. El sello vale para una spec (su huella) y una evidencia del portón (su fecha) concretas: si cambia la
// spec o el portón vuelve a medir, lo aprobado ya no es lo que hay y se pide de nuevo.

/** ¿Hay un sello de cierre para la huella de la spec y la evidencia vigentes? */
export const featureApproved = (s) => Boolean(s.closing)
  && s.closing.fingerprint === s.specs.fingerprint
  && s.closing.evidence === s.gate.date;
