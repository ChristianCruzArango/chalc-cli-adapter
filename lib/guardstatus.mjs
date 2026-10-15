// lib/guardstatus.mjs — lo que puede pasar al activar o quitar la guarda (spec 023, R1, R4, R15).
// Responsabilidad ÚNICA: nombrar cada resultado de `guardemit.mjs`. Razón de cambio: que aparezca o desaparezca
// un resultado. Vive aparte porque es el contrato entre quien escribe el archivo y quien lo cuenta al usuario.

export const GUARD_STATUS = Object.freeze({
  added: 'added',           // la guarda quedó activa (algo se escribió)
  unchanged: 'unchanged',   // ya estaba activa: nada que escribir
  removed: 'removed',       // se quitó lo que chalc había añadido
  absent: 'absent',         // no había guarda que quitar
  invalid: 'invalid'        // el archivo no se puede leer como settings: no se tocó
});
