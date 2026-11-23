// hook.mjs — lo que hace el portón cuando lo llama un hook de git (spec 029, R4, R5). Responsabilidad ÚNICA:
// decidir, para `pre-commit` y `pre-push`, si la operación sigue. Razón de cambio: qué se exige antes de un
// commit o un push.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Los hooks de git corren con cualquier asistente y también cuando commitea una persona. Por eso son baratos:
// `pre-commit` solo mide si el commit lleva código, y `pre-push` no mide nada: comprueba que ya se midió.
// Saltarlos (`--no-verify`) es decisión de una persona; al asistente se lo deniega la guarda.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stagedFiles, taskScope } from './changed.mjs';
import { STATE_REL } from './evidence.mjs';
import { scopeHash } from './fingerprint.mjs';
import { frameOf } from './i18n.mjs';
import { isUserSource } from './sources.mjs';

// El commit lleva código del proyecto (también tests): solo entonces vale la pena correr el portón rápido. Las
// herramientas de `.chalc/` no cuentan: commitearlas tras equipar no es «llevar código».
async function preCommit(io) {
  const staged = await io.staged();
  return staged.some(isUserSource) ? io.fastGate() : 0;
}

// ¿La última evidencia es de una corrida COMPLETA que aprueba, y cubre el código cambiado tal como está ahora?
async function measured(io, files) {
  const state = await io.state();
  if (!state || state.verdict !== 'pass' || state.fast !== false || !state.scopeHash) return false;
  const covered = state.scope?.files || [];
  if (!files.every((file) => covered.includes(file))) return false;
  return await io.hashOf(covered) === state.scopeHash;
}

// No se sube código sin medir. Y no se mide aquí: un push no es momento de esperar a la mutación.
async function prePush(io) {
  const scope = await io.scope();
  if (!scope.undetermined && !scope.files.length) return 0;
  if (!scope.undetermined && await measured(io, scope.files)) return 0;
  io.write(frameOf(io.lang).hook.unmeasured);
  return 1;
}

const HOOKS = { 'pre-commit': preCommit, 'pre-push': prePush };

/** Corre el hook `name` con el mundo `io`. Devuelve el código de salida; un hook desconocido no bloquea nada. */
export const runHook = async (name, io) => (HOOKS[name] ? HOOKS[name](io) : 0);

// El último estado del portón, o null si no hay o no se puede leer.
async function gateState(root) {
  try { return JSON.parse(await readFile(join(root, ...STATE_REL.split('/')), 'utf8')); } catch { return null; }
}

/** El mundo real del repo `root`: git, el estado del portón y, para medir, `fastGate` (lo aporta `gate.mjs`). */
export const hookIo = (root, { lang, fastGate, write }) => ({
  lang,
  staged: () => stagedFiles(root),
  scope: () => taskScope(root),
  state: () => gateState(root),
  hashOf: (files) => scopeHash(root, files),
  fastGate,
  write
});
