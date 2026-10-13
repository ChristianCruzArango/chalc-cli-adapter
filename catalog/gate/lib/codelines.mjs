// codelines.mjs — qué líneas de un archivo son código (spec 019, R1). Responsabilidad ÚNICA: separar el
// código de la gramática que el lenguaje obliga a escribir. Razón de cambio: qué cuenta como gramática.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// La noción de gramática NO es nueva: es la de la etapa de duplicación (`significantLines`: imports,
// `export … from`, decoradores de una línea, cierres sueltos, comentarios, vacías). Aquí se le suma lo que
// esa etapa no necesitaba: el cuerpo de un decorador de VARIAS líneas (`@Module({ … })` en NestJS), que
// tampoco es lógica que se pueda mutar. Una sola definición, ampliada, en vez de dos que se separen.

import { significantLines } from './duplication.mjs';
import { blankOut } from './source.mjs';

const DECORATOR = /^\s*@\w+(?:\.\w+)*\s*\(/;

// Las líneas que ocupa cada decorador: desde la que lo abre hasta la que cierra sus paréntesis. Se cuentan
// sobre el texto sin literales ni comentarios, para que un `)` dentro de un texto no lo cierre antes.
function decoratorLines(text) {
  const inside = new Set();
  let depth = 0;
  blankOut(text).split(/\r?\n/).forEach((line, i) => {
    if (depth === 0 && !DECORATOR.test(line)) return;
    inside.add(i + 1);
    for (const ch of line) depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
    depth = Math.max(depth, 0);
  });
  return inside;
}

/** Las líneas de `text` que son código, con su número original: `[{ line, code }]`. */
export function codeLines(text) {
  const decorators = decoratorLines(String(text ?? ''));
  return significantLines(text).filter(({ line }) => !decorators.has(line));
}
