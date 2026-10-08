// textspan.mjs — un tramo de LÍNEAS traducido a posiciones de CARÁCTER (spec 017). Responsabilidad
// ÚNICA: contar caracteres como los cuenta Roslyn. Razón de cambio: cómo lee un tramo Stryker.NET.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Stryker.NET lee `archivo.cs{a..b}` como un TextSpan de Roslyn: `a` es el primer carácter y `b` la
// posición siguiente al último. Roslyn no cuenta la marca de orden de bytes (BOM) del inicio del
// archivo, y un `\r\n` son dos caracteres.
//
// Puro a propósito: recibe el texto y el tramo, devuelve posiciones. Quien lee el archivo es `mutation.mjs`.

const BOM = '﻿';

/**
 * Posiciones `[inicio, fin)` de las líneas `desde`..`hasta` (numeradas desde 1) dentro de `texto`:
 * desde el primer carácter de `desde` hasta justo después del último de `hasta`, sin su salto.
 */
export function caracteresDeLineas(texto, desde, hasta) {
  const lineas = (texto.startsWith(BOM) ? texto.slice(1) : texto).split('\n');
  const inicioDeLinea = (numero) =>
    lineas.slice(0, numero - 1).reduce((total, linea) => total + linea.length + 1, 0);
  const largoSinSalto = (lineas[hasta - 1] ?? '').replace(/\r$/, '').length;

  return [inicioDeLinea(desde), inicioDeLinea(hasta) + largoSinSalto];
}
