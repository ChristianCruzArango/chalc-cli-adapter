// lib/pkgmanager.mjs — el gestor de paquetes de un proyecto y los comandos equivalentes (spec 027, R1–R4).
// Responsabilidad ÚNICA: elegir un gestor de la tabla y reescribir con él los comandos resueltos. Razón de
// cambio: cómo se identifica un gestor. Puro: recibe lo ya leído del repo.
//
// No nombra ningún gestor: cuáles hay, qué archivo delata a cada uno y qué comando equivale a cuál son DATOS
// del stack (`packageManagers` en `catalog/tools/*.json`). Así un proyecto con otro gestor no recibe en
// `.chalc/gate.json` comandos que no puede ejecutar.

// El valor de `a.b.c` en un objeto, o undefined.
const fieldAt = (root, path) => String(path || '').split('.').filter(Boolean).reduce((node, key) => node?.[key], root);

// El gestor que DECLARA el proyecto (`"packageManager": "pnpm@9.1.0"`): su id, o '' si no declara ninguno.
function declaredId(spec, json) {
  const value = fieldAt(json?.[spec.field?.file], spec.field?.path);
  return typeof value === 'string' ? value.split('@')[0].trim() : '';
}

/**
 * El gestor de la tabla `spec` que usa el proyecto, o null si es el de por defecto (o no hay tabla).
 * Lo declarado manda sobre cualquier lockfile; sin declarar, el primero cuyo lockfile esté en la raíz.
 */
export function managerOf(spec, { json = {}, hasFile = () => false } = {}) {
  const managers = spec?.managers || [];
  const declared = spec ? declaredId(spec, json) : '';
  if (declared) return managers.find((manager) => manager.id === declared) || null;
  return managers.find((manager) => (manager.files || []).some(hasFile)) || null;
}

// Un comando con el prefijo del gestor por defecto cambiado por el suyo. Solo si EMPIEZA por él: dentro de
// otra orden (`cross-env X=1 npm test`) no se toca, porque no se sabe qué más cambia.
function rewritten(command, pairs) {
  if (typeof command !== 'string') return command;
  const pair = pairs.find(([from]) => command.startsWith(from));
  return pair ? pair[1] + command.slice(pair[0].length) : command;
}

/** `tools` ({ test, build, mutation }) con sus comandos de scripts e instalación en el gestor dado. No muta la entrada. */
export function rewriteCommands(tools, manager) {
  const pairs = manager?.rewrite || [];
  if (!pairs.length) return tools;
  const install = (block) => (block && 'install' in block ? { install: rewritten(block.install, pairs) } : {});
  return {
    ...tools,
    test: rewritten(tools.test, pairs),
    build: tools.build && { ...tools.build, command: rewritten(tools.build.command, pairs), ...install(tools.build) },
    mutation: tools.mutation && { ...tools.mutation, ...install(tools.mutation) }
  };
}
