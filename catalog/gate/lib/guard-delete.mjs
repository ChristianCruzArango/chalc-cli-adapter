// guard-delete.mjs — la regla de borrado de la guarda (spec 017, R4). Responsabilidad ÚNICA: decir si
// una cadena de comandos borra algo fuera del proyecto. Razón de cambio: cómo se resuelve adónde apunta
// un borrado. Pura: no mira el disco (tampoco resuelve enlaces simbólicos).
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Mira la cadena ENTERA y no cada comando suelto porque un `cd` anterior cambia desde dónde se resuelve
// el borrado: `cd .. && rm -rf app` borra la carpeta de al lado aunque `app` parezca local. Lo que no se
// puede saber adónde apunta —una variable, un `cd` a un sitio desconocido— cuenta como fuera: en un
// borrado, la duda se resuelve hacia no borrar.

import { isAbsolute, relative, resolve } from 'node:path';
import { programOf, shellJoin } from './shellwords.mjs';
import { RULES } from './rules.mjs';

// Lo que la shell expande antes de borrar y aquí no se puede resolver: variables, sustituciones (que el
// lector deja como `$(…)`) y llaves (`{..,x}`).
const UNRESOLVED = /[${]/;
const segments = (path) => path.split(/[\\/]/);

// La ruta absoluta a la que apunta `target` desde `cwd`, o null si no se puede saber. `~` no se expande:
// el portón vive dentro del repo y no mira el HOME del usuario (lo vigila `gate-hook.test.mjs`).
function locate(target, { cwd }) {
  if (UNRESOLVED.test(target) || target.startsWith('~')) return null;
  if (isAbsolute(target)) return resolve(target);
  return cwd ? resolve(cwd, target) : null;
}

// Dentro del proyecto. La raíz misma solo cuenta con `rootItself`: `rm -rf .` no borra algo DEL
// proyecto, borra el proyecto.
function inside(root, full, rootItself) {
  const rel = relative(root, full);
  if (rel === '') return rootItself;
  return !isAbsolute(rel) && segments(rel)[0] !== '..';
}

// Sin raíz conocida no hay «fuera» que calcular: se bloquea solo lo que puede apuntar a cualquier sitio.
const riskyWithoutRoot = (target) => UNRESOLVED.test(target) || target.startsWith('~') || isAbsolute(target) || segments(target).includes('..');

function outside({ target, rootItself }, place) {
  if (!place.root) return riskyWithoutRoot(target);
  const full = locate(target, place);
  return full === null || !inside(place.root, full, rootItself);
}

// Los operandos de `rm`/`rmdir`: lo que no es opción, y todo lo que va tras `--`.
const notOption = (arg) => !arg.startsWith('-');

function operands(args) {
  const end = args.indexOf('--');
  if (end < 0) return args.filter(notOption);
  return [...args.slice(0, end).filter(notOption), ...args.slice(end + 1)];
}

// Las rutas de partida de un `find` que borra (`-delete`): lo que va antes de la primera expresión (que
// existe siempre: `-delete` lo es). Sin ninguna ruta, `find` parte del directorio actual.
function findStarts(args) {
  if (!args.includes('-delete')) return [];
  const starts = args.slice(0, args.findIndex((arg) => /^[-(!)]/.test(arg)));
  return starts.length ? starts : ['.'];
}

// Lo que un comando borra, cada uno con si puede ser la raíz misma. `find` nunca borra su `.` de
// partida, así que `find . -name x -delete` desde la raíz no borra el proyecto; nombrarla de otra forma
// (`find /ruta/app -delete`) sí puede.
function targetsOf([program, ...args]) {
  if (program === 'rm' || program === 'rmdir') return operands(args).map((target) => ({ target, rootItself: false }));
  if (program === 'find') return findStarts(args).map((target) => ({ target, rootItself: /^\.[\\/]?$/.test(target) }));
  return [];
}

// Dónde queda la shell tras un `cd`/`pushd`. `cd` a secas (va al home), `cd -` y lo que no se puede
// resolver dejan la posición desconocida (null).
function cwdAfter([, arg], place) {
  if (arg === undefined || arg === '-') return null;
  return locate(arg, place);
}

/** El primer borrado fuera del proyecto de una cadena de comandos simples, o null. */
export function deleteRule(commands, { root, cwd }) {
  const place = { root, cwd };
  for (const words of commands) {
    const program = programOf(words);
    if (program[0] === 'cd' || program[0] === 'pushd') { place.cwd = cwdAfter(program, place); continue; }
    const found = targetsOf(program).find((t) => outside(t, place));
    if (found) return { decision: 'deny', rule: RULES.guardDeleteOutside, data: { command: shellJoin(words), target: found.target } };
  }
  return null;
}
