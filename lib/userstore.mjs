// lib/userstore.mjs — dónde vive lo que el USUARIO añade al catálogo de chalc.
// Responsabilidad ÚNICA: separar el catálogo del paquete (de solo lectura) del estado del usuario.
//
// `configure`, `install` y `update` escribían en `CHALC_ROOT/rules` y `catalog/`, es decir, dentro
// del paquete instalado: con `npm i -g` eso da EACCES, y aunque se pudiera, el siguiente
// `npm update` lo borraba. Ahora lo del usuario va a `~/.chalc/` (o `CHALC_HOME`) y se SUPERPONE al
// catálogo: una regla, skill o MCP del usuario con el mismo id gana sobre la del paquete.
//
// Excepción deliberada: ejecutado desde un checkout de git escribible —desarrollando chalc—, se sigue
// escribiendo en el catálogo, porque ahí `chalc install` es justo cómo se vendoriza una skill nueva.

import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const userHome = () => (process.env.CHALC_HOME ? resolve(process.env.CHALC_HOME) : join(homedir(), '.chalc'));
export const userCatalog = () => join(userHome(), 'catalog');
export const userRulesDir = () => join(userHome(), 'rules');

const writable = (dir) => { try { accessSync(dir, constants.W_OK); return true; } catch { return false; } };

/** Dónde escriben `configure`, `install` y `update`: { catalog, rules, lockRoot, overlay }. */
export function writableLayout(chalcRoot) {
  const catalog = join(chalcRoot, 'catalog');
  const rules = join(chalcRoot, 'rules');
  const developing = !process.env.CHALC_HOME && existsSync(join(chalcRoot, '.git')) && writable(catalog) && writable(rules);
  return developing
    ? { catalog, rules, lockRoot: chalcRoot, overlay: false }
    : { catalog: userCatalog(), rules: userRulesDir(), lockRoot: userHome(), overlay: true };
}

/** Carpeta de una skill: la del usuario, si existe, gana sobre la del paquete. */
export function skillDir(catalog, id) {
  const mine = join(userCatalog(), 'skills', id);
  return existsSync(mine) ? mine : join(catalog, 'skills', id);
}

/** Archivo de definición de un MCP, con la misma precedencia. */
export function mcpFile(catalog, id) {
  const mine = join(userCatalog(), 'mcp', `${id}.json`);
  return existsSync(mine) ? mine : join(catalog, 'mcp', `${id}.json`);
}

const entries = (dir, pick) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(pick).map((d) => d.name) : []);

/** Ids de skills del paquete y del usuario, sin repetir y ordenados. */
export const skillIds = (catalog) => [...new Set([
  ...entries(join(catalog, 'skills'), (d) => d.isDirectory()),
  ...entries(join(userCatalog(), 'skills'), (d) => d.isDirectory())
])].sort();

/** Ids de MCP del paquete y del usuario, sin repetir y ordenados. */
export const mcpIds = (catalog) => [...new Set([
  ...entries(join(catalog, 'mcp'), (d) => d.isFile() && d.name.endsWith('.json')),
  ...entries(join(userCatalog(), 'mcp'), (d) => d.isFile() && d.name.endsWith('.json'))
].map((f) => f.replace(/\.json$/, '')))].sort();
