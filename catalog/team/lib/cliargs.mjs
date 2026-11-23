// cliargs.mjs — los argumentos de `team.mjs` (specs 032, 033). Responsabilidad ÚNICA: separar opciones, pares
// `clave=valor` y posicionales. Razón de cambio: la forma de la línea de comandos.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Los valores van como `clave=valor` y no como JSON: así ningún argumento lleva comillas, llaves ni otros
// caracteres que la shell de Windows rechaza.

// Las opciones que llevan un valor detrás: ese valor no es un posicional.
const WITH_VALUE = new Set(['--root', '--feature', '--spec', '--agent', '--base', '--role']);
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const typed = (value) => (value === 'true' ? true : value === 'false' ? false : NUMBER.test(value) ? Number(value) : value);

/** El valor que sigue a `--nombre`, o ''. */
export const option = (args, name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] || '' : ''; };

/** Los argumentos que no son una opción ni el valor de una. */
export const positionals = (args) => args.filter((arg, index) => !arg.startsWith('-') && !WITH_VALUE.has(args[index - 1]));

/** Los argumentos `clave=valor` como objeto: números y booleanos con su tipo; lo demás, texto. */
export function parsePairs(args) {
  const pairs = positionals(args).filter((arg) => arg.indexOf('=') > 0);
  return Object.fromEntries(pairs.map((arg) => [arg.slice(0, arg.indexOf('=')), typed(arg.slice(arg.indexOf('=') + 1))]));
}
