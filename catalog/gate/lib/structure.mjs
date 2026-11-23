// structure.mjs — dónde nace el código (spec 031, R3–R5). Responsabilidad ÚNICA: señalar el archivo de
// producción que la tarea CREÓ fuera de las carpetas de la arquitectura acordada. Razón de cambio: qué cuenta
// como estar en su sitio.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// El linter de fronteras mira qué importa cada archivo; esto mira dónde se crea. Solo lo nuevo: mover lo que
// ya existía es otra tarea. Las carpetas viven en `structure.folders` de `.chalc/gate.json` (las escribe
// `chalc init`); `structure.allow` son las excepciones que el proyecto decida.

import { RULES } from './rules.mjs';
import { isTestFile, isUserSource } from './sources.mjs';

const unix = (path) => String(path).replace(/\\/g, '/').replace(/\/+$/, '');
const under = (file, dir) => file === dir || file.startsWith(`${dir}/`);

/** Los archivos de producción NUEVOS de `files` que no caen en `folders` ni en `allow`. */
export function outsideStructure(files, { folders = [], allow = [], isNew }) {
  const valid = [...folders, ...allow].map(unix);
  return files.map(unix)
    .filter((file) => file.includes('/') && isUserSource(file) && !isTestFile(file) && isNew(file))
    .filter((file) => !valid.some((dir) => under(file, dir)))
    .map((file) => ({ file, line: 1, rule: RULES.fileOutsideStructure, data: { folders } }));
}

/**
 * Lo mismo, con el alcance de la tarea y la config. Es nuevo el archivo del alcance sin líneas atribuidas en el
 * diff y del que tampoco se borró nada. Sin carpetas declaradas o sin git (no se sabe qué es nuevo), no aplica.
 */
export function structureFindings(scope, config) {
  const folders = config.structure?.folders || [];
  if (!folders.length || !scope.from || !scope.lines) return [];
  const isNew = (file) => !scope.lines.has(file) && !scope.removed?.has(file);
  return outsideStructure(scope.files, { folders, allow: config.structure.allow || [], isNew });
}
