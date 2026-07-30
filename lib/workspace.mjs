// lib/workspace.mjs — workspace por HU para el modo worktree (spec 005). Responsabilidad única:
// materializar "una HU = una carpeta" — puerta de entrada (repos listos), plan de rutas, creación
// todo-o-nada de los worktrees, handoff en la raíz y carpeta base recordada en la config global.
// Nunca borra ni fuerza nada: crear es lo único que hace, y solo si TODO el pre-flight pasa.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { safePull, gitStatus } from './gitprep.mjs';
import { addWorktree } from './gitworktree.mjs';
import { CONFIG_PATH } from './ai.mjs';

// Motivos de safePull que dejan pasar la puerta: al día, avanzado por ff, o repo local sin
// remoto (no puede hacer pull; con árbol limpio no hay nada que traer). El resto bloquea.
const GATE_OK = new Set(['up-to-date', 'fast-forwarded', 'no-upstream']);

// Puerta bloqueante (R3, R4): TODOS los repos limpios y al día ANTES de gastar tokens.
// sides = [{ name, path }]. Devuelve { ok, results: [{ name, ok, reason }] }.
export async function workspaceGate(sides) {
  const results = [];
  for (const { name, path } of sides) {
    const pull = await safePull(path);
    results.push({ name, ok: GATE_OK.has(pull.reason), reason: pull.reason });
  }
  return { ok: results.every((r) => r.ok), results };
}

// Nombre fijo de la subcarpeta de trabajo: los workspaces NUNCA se riegan en la carpeta que el
// usuario indique — siempre viven en <ruta>/chalc-workspaces (R8).
const WORKSPACES_DIRNAME = 'chalc-workspaces';

// Normaliza la carpeta base (R8): cualquier ruta del usuario aterriza en su subcarpeta
// chalc-workspaces; si la ruta ya termina en ella (da igual mayúsculas en Windows), se respeta.
export function workspaceBaseDir(userPath) {
  const p = String(userPath).replace(/[\\/]+$/, '');
  return basename(p).toLowerCase() === WORKSPACES_DIRNAME ? p : join(p, WORKSPACES_DIRNAME);
}

// Plan de rutas del workspace (R8, R9): <base>/<id>/<lado>. Puro: no toca disco.
export function planWorkspace(baseDir, id, sides) {
  const dir = join(baseDir, id);
  return { dir, sides: sides.map(({ name, path }) => ({ name, repo: path, dest: join(dir, name) })) };
}

// Crea el workspace: un worktree por lado sobre `branch`, TODO-O-NADA (R9, R10). Deshacer un
// worktree exigiría `remove` (prohibido), así que el pre-flight verifica TODO antes de crear NADA:
// cada lado es un repo y ningún destino existe. Devuelve { ok, failures, created }.
export async function createWorkspace(plan, branch) {
  const failures = [];
  for (const side of plan.sides) {
    if (!(await gitStatus(side.repo)).isRepo) failures.push({ name: side.name, reason: 'not-a-repo' });
    else if (existsSync(side.dest)) failures.push({ name: side.name, reason: 'dest-exists' });
  }
  if (failures.length) return { ok: false, failures, created: [] };

  await mkdir(plan.dir, { recursive: true });
  const created = [];
  for (const side of plan.sides) {
    const res = await addWorktree(side.repo, side.dest, branch);
    // El pre-flight cubrió lo previsible; si git falla igual (p. ej. rama montada en otro
    // worktree), se reporta lo creado hasta aquí — nunca se intenta deshacer.
    if (!res.ok) return { ok: false, failures: [{ name: side.name, reason: res.reason }], created };
    created.push({ name: side.name, dest: side.dest, reason: res.reason });
  }
  return { ok: true, failures: [], created };
}

// Escribe el hand-off del orquestador en la raíz del workspace (R11). Devuelve la ruta escrita.
export async function writeHandoff(dir, text) {
  const file = join(dir, 'handoff.md');
  await writeFile(file, String(text).replace(/\s*$/, '') + '\n', 'utf8');
  return file;
}

// Lee la config global directamente (SIN loadConfig: aquélla mezcla overrides de entorno que
// no deben persistirse). Corrupta o inexistente → objeto vacío.
async function readConfigFile(configPath) {
  try { return JSON.parse(await readFile(configPath, 'utf8')); } catch { return {}; }
}

// Recuerda la carpeta base de workspaces en la config global, preservando el resto (R8).
export async function rememberWorkspaceDir(dir, configPath = CONFIG_PATH) {
  const cfg = await readConfigFile(configPath);
  cfg.workspaceDir = dir;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return configPath;
}

// Carpeta base recordada, o '' si nunca se guardó (R8; la usa también el dashboard de la spec 006).
export async function recallWorkspaceDir(configPath = CONFIG_PATH) {
  return (await readConfigFile(configPath)).workspaceDir || '';
}
