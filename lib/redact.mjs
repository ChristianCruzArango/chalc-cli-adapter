// lib/redact.mjs — re-exporta la redacción de secretos, que vive en el portón (spec 020): el registro de
// actividad del tablero la necesita dentro del repo equipado, donde `lib/` no existe.
export * from '../catalog/gate/lib/redact.mjs';
