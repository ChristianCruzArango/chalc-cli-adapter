// config.mjs — con qué corre cada rol (spec 034, R4, R6). Responsabilidad ÚNICA: leer `.chalc/team.json` y dar,
// por rol, su lanzador, su nivel de modelo, su comando y sus skills. Razón de cambio: qué se puede configurar.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: ajusta `.chalc/team.json`.
//
// chalc no lanza ningún modelo: dice con qué se lanza cada rol y quien despacha lo ejecuta. Lo que no se entiende
// cae al valor por defecto, y el valor por defecto es el exigente: quien juzga corre en el nivel más alto.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Los niveles de modelo, del más barato al más capaz. */
export const TIERS = Object.freeze(['economico', 'medio', 'alto']);
/** Cómo se lanza un rol: el subagente del propio asistente, o el comando no interactivo de otro. */
export const LAUNCHERS = Object.freeze(['nativo', 'comando']);

// Quien escribe el código no necesita el modelo más caro: lo que escribe lo miden el portón y quien lo revisa.
const DEFAULT_TIER = Object.freeze({ desarrollador: 'medio' });
const DEFAULT_PARALLEL = 3;
// Lo que `cmd.exe` rechaza en un argumento: un comando que lo lleve no se podría lanzar en Windows.
const UNSAFE = /[&|<>()^%!\r\n]/;

/** El contenido de `.chalc/team.json` de `root`, o {} si no existe o no es un objeto. */
export async function readTeamConfig(root) {
  try {
    const raw = JSON.parse(await readFile(join(root, '.chalc', 'team.json'), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/** { launcher, tier, command, skills } de `role`. Lo que falta o no vale, por defecto. */
export function roleConfig(raw, role) {
  const roles = raw?.roles && typeof raw.roles === 'object' ? raw.roles : {};
  const own = roles[role] && typeof roles[role] === 'object' ? roles[role] : {};
  return {
    launcher: oneOf(own.launcher, LAUNCHERS, 'nativo'),
    tier: oneOf(own.tier, TIERS, DEFAULT_TIER[role] || 'alto'),
    command: typeof own.command === 'string' ? own.command : '',
    skills: Array.isArray(own.skills) ? own.skills.filter((skill) => typeof skill === 'string' && skill.trim()) : []
  };
}

/** El nivel que sigue a `tier`, o '' si no hay ninguno por encima. */
export const nextTier = (tier) => TIERS[TIERS.indexOf(tier) + 1 || TIERS.length] || '';

/** Cuántas specs pueden estar en desarrollo a la vez. */
export const maxParallel = (raw) => (Number.isInteger(raw?.maxParallel) && raw.maxParallel > 0 ? raw.maxParallel : DEFAULT_PARALLEL);

/** Por qué `command` no se puede entregar: '', `no-command`, `no-order` o `unsafe-command`. */
export function commandProblem(command) {
  if (!String(command ?? '').trim()) return 'no-command';
  if (UNSAFE.test(command)) return 'unsafe-command';
  return command.includes('{orden}') ? '' : 'no-order';
}

/** El comando con la ruta de la orden y la carpeta de trabajo, entre comillas. */
export const resolveCommand = (command, { order, dir }) => command.split('{orden}').join(`"${order}"`).split('{carpeta}').join(`"${dir}"`);
