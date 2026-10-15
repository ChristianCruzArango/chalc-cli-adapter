// lib/commands/guardstep.mjs — el paso de la guarda de commit y push que comparten `init` y `apply` (spec 023,
// R4, R5, R8, R9, R13–R15). Responsabilidad ÚNICA: decidir si se pide activar o quitar la guarda y contar
// qué pasó. Razón de cambio: cuándo se ofrece la guarda y cómo se informa. La escritura es `guardemit.mjs`.
//
// No imprime: devuelve las líneas ya traducidas y cada comando las muestra a su manera (plan o resultado).

import { t } from '../i18n.mjs';
import { disableGuard, enableGuard } from '../guardemit.mjs';
import { GUARD_STATUS } from '../guardstatus.mjs';

// La guarda dura solo existe en Claude Code: los demás asistentes no tienen sus hooks ni sus permisos `ask`.
const GUARD_TARGET = 'claude';

const STATUS_TEXT = Object.freeze({
  [GUARD_STATUS.added]: 'guardAdded',
  [GUARD_STATUS.unchanged]: 'guardUnchanged',
  [GUARD_STATUS.removed]: 'guardRemoved',
  [GUARD_STATUS.absent]: 'guardAbsent',
  [GUARD_STATUS.invalid]: 'guardInvalid'
});

/**
 * Qué se pide: `true` activar, `false` quitar, `null` no tocar. El flag manda; sin él, solo pregunta quien
 * tiene `prompter` (init interactivo) y equipa para Claude Code, con «sí» por defecto.
 */
export async function guardWanted({ flag, prompter, targetName }) {
  if (typeof flag === 'boolean') return flag;
  if (!prompter || targetName !== GUARD_TARGET) return null;
  return prompter.yesno(t('guardQ'), true);
}

/** Cumple `want` en `projectPath` y devuelve las líneas a mostrar. En dry-run solo las describe. */
export async function runGuardStep(projectPath, { want, targetName, dryRun }) {
  if (want === null) return [];
  // Quitarla no depende del asistente: solo retira lo que chalc puso.
  if (want && targetName !== GUARD_TARGET) return [t('guardOnlyClaude', targetName)];
  if (dryRun) return [t(want ? 'guardDryAdd' : 'guardDryRemove')];
  const status = await (want ? enableGuard : disableGuard)(projectPath);
  return [t(STATUS_TEXT[status])];
}
