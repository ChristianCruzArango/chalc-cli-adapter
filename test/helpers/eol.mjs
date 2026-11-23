// test/helpers/eol.mjs — cambia SOLO el fin de línea de un texto, venga como venga.
// En Windows el checkout ya trae `\r\n` (autocrlf): añadir `\r` a ciegas dejaba `\r\r\n`, que sí es otro contenido.

/** El mismo texto con el otro fin de línea: de `\n` a `\r\n`, o de `\r\n` a `\n`. */
export const flipEol = (text) => (text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text.replace(/\n/g, '\r\n'));
