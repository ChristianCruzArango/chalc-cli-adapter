// lib/mutationsetup.mjs — qué falta para que la herramienta de mutación de un repo funcione (spec 027, R5, R6).
// Responsabilidad ÚNICA: comparar lo que la tabla de herramientas resolvió con lo que hay en el disco. Razón de
// cambio: qué cuenta como «lista». No ejecuta ni escribe nada: eso es `commands/mutationstep.mjs`.
//
// No nombra ninguna herramienta: el comando de instalación, la sonda y el archivo de configuración vienen de
// `catalog/tools/*.json`, resueltos por `tooltable.mjs` para ESTE repo.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const inProject = (projectPath, rel) => existsSync(join(projectPath, ...rel.split('/')));

/**
 * El plan de puesta a punto: { install, installed, configFile, config, configMissing }, o null si el stack no
 * tiene herramienta de mutación con comando de instalación (no hay nada que ofrecer).
 */
export function mutationPlan(projectPath, tools) {
  const mutation = tools?.mutation;
  if (!mutation?.install) return null;
  const { configFile, config } = tools.equip;
  return {
    install: mutation.install,
    installed: Boolean(mutation.probe) && inProject(projectPath, mutation.probe),
    configFile,
    config,
    configMissing: Boolean(configFile && config) && !inProject(projectPath, configFile)
  };
}

/** El comando de instalación como paso ejecutable en el proyecto: programa y argumentos por separado. */
export function installStep(install) {
  const [command, ...args] = install.trim().split(/\s+/);
  return { label: install.trim(), command, args, cwd: 'project' };
}
