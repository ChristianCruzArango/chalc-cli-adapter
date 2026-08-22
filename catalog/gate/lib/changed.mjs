// changed.mjs — los archivos que la tarea tocó. Responsabilidad ÚNICA: decir sobre qué se revisa.
// Razón de cambio: cómo se determina el alcance de una tarea.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Acotar a lo cambiado es lo que hace usable al portón: en un repo con historia, revisar el árbol
// entero produciría cientos de hallazgos que nadie va a mirar, y la tarea de hoy quedaría enterrada
// entre deuda de hace tres años.

import { spawn } from 'node:child_process';
import { isUserSource } from './sources.mjs';
import { readBaseline } from './baseline.mjs';
import { readTouched } from './touched.mjs';
import { resolveScope } from './scope.mjs';
import { parseHunks, removedByFile } from './hunks.mjs';

// Salida de un comando de git, o null si git no está o el repo no existe.
function git(args, cwd) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out : null));
  });
}

const lines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// La rama actual, o '' si no se puede saber. Va en la evidencia.
export async function currentBranch(root) {
  const out = await git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  return out ? out.trim() : '';
}

// Archivos cambiados respecto a la base de la rama, más lo que aún no está commiteado. Rutas
// relativas con '/'.
//
// SIN GIT se revisa el árbol de fuentes entero. Devolver [] sería decir "no hay nada que revisar", y
// el portón aprobaría en silencio un repo que nunca miró — que es justo lo que esta spec quita. Con
// git y sin cambios, [] sí es la respuesta correcta: no se tocó nada.
export async function changedFiles(root) {
  return (await taskScope(root)).files;
}

// El alcance de la tarea, con su procedencia. Es el único punto con efectos: aquí se leen las tres
// fuentes —línea base, registro de rutas escritas y git— y se le pasan a la política.
//
// El orden de preferencia no es arbitrario. El registro sabe qué escribió ESTA tarea; el diff desde
// la línea base sabe qué cambió desde que empezó; el diff contra la rama solo sabe qué cambió desde
// que la rama nació, que son todas las tareas juntas. De más específico a más grueso, y el que
// mande queda dicho en `source` para que la evidencia pueda declararlo (R7).
//
// `from` es la referencia contra la que se midió y `staleRegistry` avisa de que había un registro
// pero era de la tarea anterior. Los dos existen por lo mismo: nada se descarta en silencio.
export async function taskScope(root) {
  const baseline = await readBaseline(root);
  const registry = await readTouched(root, { since: baseline.date });

  const ref = baseline.commit || await mergeBase(root);
  const diff = await changedSince(root, ref);

  return {
    ...resolveScope({ registry: registry.files, diff, diffSource: baseline.exists ? 'baseline' : 'branch' }),
    from: ref,
    ...await changedLineInfo(root, ref),
    staleRegistry: registry.stale
  };
}

// Qué líneas escribió y cuántas borró la tarea en cada archivo ya versionado, para poder decir de
// quién es cada hallazgo. Devuelve { lines: Map<archivo, Set<línea>>, removed: Map<archivo, número> }.
//
// Sin git los dos mapas van vacíos, y entonces cada archivo se revisa entero: es el comportamiento
// seguro, porque sin diff no se puede atribuir nada.
//
// Los archivos nuevos no aparecen aquí, y no hace falta que aparezcan: sin entrada en el mapa se
// revisan completos, que es exactamente lo que corresponde a un archivo que escribió la tarea.
export async function changedLineInfo(root, ref) {
  if (!await isRepo(root)) return { lines: new Map(), removed: new Map() };

  // UN solo diff. `git diff <ref>` compara el árbol de trabajo contra la referencia, así que ya
  // incluye lo commiteado y lo que no. Sumarle un `diff HEAD` contaría dos veces cada línea
  // borrada —los Set de líneas lo disimulaban, el conteo de borradas no—, y con ese doble conteo
  // un archivo parecería haber sido más grande de lo que era.
  const texto = await git(['diff', '-U0', '--diff-filter=d', ref || 'HEAD'], root) || '';

  return { lines: parseHunks(texto), removed: removedByFile(texto) };
}

// El commit actual, o '' si no se puede saber. Es lo que el portón sella como línea base de la
// tarea siguiente (spec 013, R1).
export async function headCommit(root) {
  const out = await git(['rev-parse', 'HEAD'], root);
  return out ? out.trim() : '';
}

// ¿Hay un repo de git en `root`? Lo necesita quien tiene que distinguir «no cambió nada» de «no
// puedo saberlo» (spec 013, R4b), que son dos respuestas con consecuencias opuestas.
export const isRepo = async (root) => !!await git(['rev-parse', '--is-inside-work-tree'], root);

// Los archivos cambiados DESDE `ref`, más lo que aún no está commiteado. Rutas relativas con '/'.
//
// Devuelve `null` cuando no se puede responder: no hay repo, o la referencia no resuelve —un commit
// que un rebase se llevó por delante—. `null` no es `[]`: uno significa «no sé» y el otro «no
// cambió nada». Confundirlos es exactamente lo que la spec 013 vino a quitar, porque el segundo
// pasa por aprobado y el primero tiene que bloquear (R4b, R13).
export async function changedSince(root, ref) {
  if (!await isRepo(root)) return null;

  const found = new Set();

  if (ref) {
    const diff = await git(['diff', '--name-only', '--diff-filter=d', ref], root);
    if (diff === null) return null;
    lines(diff).forEach((f) => found.add(f));
  }

  // Lo que está en el árbol de trabajo y todavía no se commiteó: es justo lo que se acaba de hacer.
  //
  // `-uall` es necesario: sin él, git colapsa lo no trackeado a la CARPETA (`?? src/`) en vez de
  // listar sus archivos. El portón no puede lintar un directorio, así que los archivos nuevos —los
  // de la tarea recién empezada— quedaban fuera de la revisión; y el advisor de la spec 008 medía
  // la frescura contra la fecha de una carpeta, que cambia por motivos que no son código.
  const status = await git(['status', '--porcelain', '-uall'], root);
  if (status) {
    for (const line of lines(status)) {
      const path = line.replace(/^\S+\s+/, '').split(' -> ').pop();
      if (path) found.add(path);
    }
  }

  return [...found].map((f) => f.replace(/\\/g, '/')).filter(isUserSource).sort();
}

// El punto del que salió la rama. Se prueban las bases habituales; la primera que exista manda.
// '' si no se puede saber. Es el respaldo de R4: sin línea base de tarea se mide contra esto, que
// sigue siendo «archivos modificados» aunque sea de más — nunca el proyecto entero.
export async function mergeBase(root) {
  for (const candidate of ['develop', 'main', 'master']) {
    const base = await git(['merge-base', 'HEAD', candidate], root);
    if (base && base.trim()) return base.trim();
  }
  return '';
}
