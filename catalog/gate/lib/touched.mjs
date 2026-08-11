// touched.mjs — el registro de rutas que la tarea escribió (spec 013, R10). Responsabilidad ÚNICA:
// leer, añadir y vaciar `.chalc/task.files`. Razón de cambio: el formato de ese registro.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Por qué no basta con el diff: el diff no sabe de tareas. Ve un árbol con cambios y no distingue
// los que hizo esta tarea de los que ya estaban a medias por otra cosa. Quien escribe SÍ lo sabe —el
// harness por sus tools, un asistente externo por su hook (R10b)—, así que se le pide que lo anote.
// Cuando este registro existe, ES el alcance; el diff queda de respaldo.
//
// Formato deliberadamente tonto: una ruta relativa por línea, append-only. Lo escriben procesos
// distintos, a veces a la vez, y algunos son hooks de shell de una línea. Cualquier cosa con
// estructura —JSON, un índice— obligaría a leer-modificar-escribir y perdería anotaciones por
// carreras entre procesos. Duplicados y basura se limpian al LEER, que es donde hay un solo lector.

import { appendFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const TOUCHED_REL = '.chalc/task.files';

const NOTHING = { files: [], stale: false };

// Margen para comparar la fecha del registro con la del sello. La fecha de un archivo no tiene la
// resolución de `Date.now()`: según el sistema de archivos va redondeada, a veces al segundo. Sin
// margen, un registro escrito JUSTO DESPUÉS de sellar la línea base puede tener un `mtime` anterior
// a ella y pasar por obsoleto — y el alcance caería al diff en silencio, colando otra vez el trabajo
// suelto del árbol. Es el fallo original de la spec reapareciendo por una diferencia de
// milisegundos.
//
// Quien de verdad limpia el registro al cerrar tarea es `clearTouched`. Esta comprobación es la red
// por si aquello falló, y una red generosa sigue atrapando lo que importa: un registro de la tarea
// anterior es viejo de minutos u horas, no de un segundo.
const CLOCK_SLACK_MS = 5000;

// Una ruta anotada, normalizada. Windows anota con barras invertidas y el resto del portón trabaja
// con '/': el alcance no puede depender del separador de quien escribió.
const clean = (path) => String(path ?? '').replace(/\\/g, '/').trim();

// Anota rutas en el registro. Anotar NUNCA puede tumbar a quien está trabajando: si falla, el efecto
// es quedarse sin registro, y sin registro el alcance cae al diff desde la línea base (R2).
export async function recordTouched(root, paths = []) {
  const lines = [...new Set((paths || []).map(clean).filter(Boolean))];
  if (!lines.length) return;

  const path = join(root, TOUCHED_REL);
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, lines.join('\n') + '\n', 'utf8');
  } catch { /* sin registro se revisa por diff; romper el turno del coder sería mucho peor */ }
}

// Las rutas registradas, deduplicadas y ordenadas.
//
// `since` es la fecha de la línea base: un registro anterior a ella es de la tarea PASADA y no se usa
// —heredarlo haría crecer el alcance tarea a tarea hasta volver a ser el de la rama—. Se devuelve
// `stale` en vez de callarlo, porque la evidencia tiene que poder decir por qué el alcance salió del
// diff y no del registro (R7).
export async function readTouched(root, { since = 0 } = {}) {
  const path = join(root, TOUCHED_REL);

  let text;
  try { text = await readFile(path, 'utf8'); } catch { return { ...NOTHING }; }

  if (since) {
    try { if ((await stat(path)).mtimeMs < since - CLOCK_SLACK_MS) return { files: [], stale: true }; } catch { return { ...NOTHING }; }
  }

  return { files: [...new Set(text.split(/\r?\n/).map(clean).filter(Boolean))].sort(), stale: false };
}

// Vacía el registro. Lo llama el portón al sellar una línea base nueva: la tarea siguiente empieza
// sin heredar nada. Si no hay registro no se crea uno vacío — "no hay" y "está vacío" se leen igual
// aquí, y crear archivos que nadie pidió ensucia el `.chalc/` del usuario.
export async function clearTouched(root) {
  try { await rm(join(root, TOUCHED_REL), { force: true }); } catch { /* nada que vaciar */ }
}
