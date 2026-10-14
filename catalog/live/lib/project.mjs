// project.mjs — para qué harness y en qué idioma se equipó el proyecto (spec 020, R22). Responsabilidad ÚNICA:
// leer `target` y `lang` de `.chalc.json`. Razón de cambio: dónde guarda chalc esa elección.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// El tablero corre como proceso aparte, sin el entorno del agente: el idioma que se eligió al equipar está aquí,
// y `gate.json` puede dejarlo vacío («el de la interfaz»). Un archivo ausente o roto no rompe nada: '' y ''.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const PROJECT_REL = '.chalc.json';

const text = (value) => (typeof value === 'string' ? value : '');

/** `{ target, lang }` del proyecto en `root`; '' en lo que no se sepa. */
export async function readProject(root) {
  try {
    const data = JSON.parse(await readFile(join(root, PROJECT_REL), 'utf8'));
    return { target: text(data?.target), lang: text(data?.lang) };
  } catch { return { target: '', lang: '' }; }
}
