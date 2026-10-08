// lib/termsafe.mjs — texto ajeno apto para la terminal. Responsabilidad ÚNICA: que un dato que no
// escribió chalc (un asunto de commit, la salida de una herramienta, la respuesta de un modelo) no
// pueda mover el cursor, borrar líneas, ocultar texto ni escribir en el portapapeles (OSC 52).
//
// Se quitan los caracteres de control C0 y C1 —ESC incluido, que es el que abre toda secuencia—
// salvo el salto de línea y el tabulador. Lo que queda de la secuencia (`[2K`) se ve como texto
// inofensivo, que es justo lo que se quiere: el humano ve que había algo raro.

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
// eslint-disable-next-line no-control-regex
const SGR_OR_CONTROL = /\x1b\[([0-9;]*)m|[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

// Los estilos que pinta la PROPIA interfaz: reinicio, negrita, tenue, cursiva, subrayado y colores.
// Fuera quedan, entre otros, `8` (texto oculto), `5` (parpadeo) y `7` (vídeo inverso).
const SAFE_SGR = new Set(['', '0', '1', '2', '3', '4', '22', '23', '24', '39', '49',
  ...Array.from({ length: 8 }, (_, i) => String(30 + i)), ...Array.from({ length: 8 }, (_, i) => String(40 + i)),
  ...Array.from({ length: 8 }, (_, i) => String(90 + i))]);

/**
 * Quita los controles. Con `keepStyles`, conserva las secuencias de color/estilo de la lista segura:
 * es lo que permite sanear en el ÚLTIMO paso (el `print` de la interfaz), donde el texto ya trae los
 * colores propios mezclados con lo que dijo el modelo o devolvió una herramienta.
 */
export function stripControl(text, { keepStyles = false } = {}) {
  const source = String(text ?? '');
  if (!keepStyles) return source.replace(CONTROL, '');
  return source.replace(SGR_OR_CONTROL, (match, params) =>
    (params !== undefined && params.split(';').every((p) => SAFE_SGR.has(p)) ? match : ''));
}
