// lib/roles.mjs — el catálogo de roles de revisión (spec 009, R1, R3, R4).
// Responsabilidad ÚNICA: cargar los contratos y decir qué se le concede a cada rol.
// Razón de cambio: el modelo de rol.
//
// Antes, el alcance del único rol que había vivía en dos sitios que nadie obligaba a coincidir: la
// constante `REVIEWER_TOOLS` de `lib/targetkit.mjs` —lo que Claude Code concedía de verdad— y la
// prosa del prompt —lo que el rol creía poder hacer—. Cuando la spec 008 necesitó que el revisor
// dejara bitácora hubo que tocar la constante, la plantilla y un test que afirmaba lo contrario.
//
// La carga es genérica: este módulo no conoce ningún rol. Si los conociera, añadir uno volvería a
// ser tocar código (R4).

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from './i18n.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

export const AGENTS_DIR = join(ROOT, 'catalog', 'agents');

// Herramientas que modifican el repo. Se separan en dos grupos porque no son el mismo permiso:
// crear la bitácora propia y editar código ajeno son cosas distintas, y un rol de revisión que pueda
// hacer lo segundo deja de ser una segunda opinión para ser otra mano en el mismo código.
const CREATE_TOOLS = new Set(['Write']);
const EDIT_TOOLS = new Set(['Edit', 'NotebookEdit', 'MultiEdit']);

// Los roles declarados, ordenados. Una carpeta sin `contract.json` no es un rol —puede ser
// documentación— y un contrato con una errata se descarta en vez de tumbar la carga: un rol roto no
// puede dejar sin equipar a los demás. Pero se AVISA: la errata es un bug del catálogo y callarla
// dejaba al usuario sin un rol sin saber por qué.
export async function loadRoles(dir = AGENTS_DIR) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }

  const roles = [];
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const file = join(dir, entry.name, 'contract.json');
    if (!existsSync(file)) continue;   // sin contrato: no es un rol
    try { roles.push(JSON.parse(await readFile(file, 'utf8'))); } catch (e) { console.warn(`  ! ${t('catalogBadJson', file, e.message)}`); }
  }
  return roles.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
}

// Las herramientas que se le conceden a un rol: EXACTAMENTE las que declara, tras comprobar que no
// pide más de lo que su alcance justifica (R3).
//
// Lanza en vez de recortar en silencio. Un contrato incoherente es un bug de chalc, y recortar lo
// escondería: el rol se emitiría con menos permisos de los que su prompt dice tener, y fallaría en
// el repo del usuario haciendo algo que su propia plantilla le manda hacer.
export function toolsFor(role) {
  const writes = role.writes || [];
  const tools = role.tools || [];

  for (const tool of tools) {
    if (EDIT_TOOLS.has(tool)) {
      throw new Error(t('roleNoEdit', role.id, tool));
    }
    if (CREATE_TOOLS.has(tool) && !writes.length) {
      throw new Error(t('roleNoWrites', role.id, tool));
    }
  }
  return [...tools];
}
