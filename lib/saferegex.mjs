// lib/saferegex.mjs — expresiones regulares que escribió OTRO (el modelo, un archivo del repo).
// Responsabilidad ÚNICA: que una de ellas no pueda congelar el proceso.
//
// `(a+)+$` contra 120 «a» y un «!» no termina en una vida: el retroceso es exponencial. Como corre
// en el hilo principal, bloquea el event loop y ni ESC ni Ctrl+C pueden interrumpirlo. Dentro de un
// contexto `vm` con `timeout`, V8 sí lo corta. Un patrón sin metacaracteres no necesita nada de esto:
// se busca como texto literal, que además es lo que casi siempre se quería decir.

import vm from 'node:vm';

const DEFAULT_TIMEOUT_MS = 250;
const META = /[\\^$.*+?()[\]{}|]/;
const SCRIPT = new vm.Script('lines.map((line) => { re.lastIndex = 0; return re.test(line); })');
const context = vm.createContext({});

export class RegexTimeoutError extends Error {
  constructor(pattern) {
    super(`regex too slow (catastrophic backtracking?): ${pattern}`);
    this.name = 'RegexTimeoutError';
  }
}

/** ¿El patrón usa sintaxis de expresión regular, o es texto literal? */
export const isLiteral = (pattern) => !META.test(String(pattern));

/** Escapa un texto para usarlo literal dentro de una expresión regular. */
export const escapeRegExp = (text) => String(text).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/**
 * Un comprobador `lines → boolean[]` para el patrón. Literal: `includes`. Regex: dentro de un `vm`
 * con `timeoutMs` por lote; si se agota, lanza RegexTimeoutError. Un patrón inválido lanza al crear.
 */
export function lineMatcher(pattern, { flags = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const text = String(pattern);
  if (isLiteral(text) && !flags.includes('i')) return (lines) => lines.map((line) => line.includes(text));
  const re = new RegExp(text, flags.replace(/[gy]/g, ''));
  return (lines) => {
    context.re = re;
    context.lines = lines;
    try {
      return SCRIPT.runInContext(context, { timeout: timeoutMs });
    } catch (e) {
      if (e?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new RegexTimeoutError(text);
      throw e;
    } finally {
      context.re = null;
      context.lines = null;
    }
  };
}

/** ¿`text` casa con `pattern`? Con el mismo límite de tiempo que lineMatcher. */
export function safeTest(pattern, text, opts) {
  return lineMatcher(pattern, opts)([String(text)])[0];
}

// Cuantificador aplicado a un grupo que ya contiene otro cuantificador: `(a+)+`, `(\w*)*`, `(x+){2,}`.
// Es la forma de los patrones con retroceso exponencial; sirve para no copiar uno a código generado.
const NESTED_QUANTIFIER = /\([^()]*[+*}][^()]*\)\s*[+*{]/;
export const hasNestedQuantifier = (pattern) => NESTED_QUANTIFIER.test(String(pattern));
