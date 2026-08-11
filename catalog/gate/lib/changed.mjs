// changed.mjs — los archivos que la tarea tocó. Responsabilidad ÚNICA: decir sobre qué se revisa.
// Razón de cambio: cómo se determina el alcance de una tarea.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Acotar a lo cambiado es lo que hace usable al portón: en un repo con historia, revisar el árbol
// entero produciría cientos de hallazgos que nadie va a mirar, y la tarea de hoy quedaría enterrada
// entre deuda de hace tres años.

import { spawn } from 'node:child_process';
import { sourceFiles, SOURCE_FILE } from './sources.mjs';

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
export async function changedFiles(root, { base = '' } = {}) {
  if (!await git(['rev-parse', '--is-inside-work-tree'], root)) return (await sourceFiles(root)).files;

  const found = new Set();

  const against = base || await mergeBase(root);
  if (against) {
    const diff = await git(['diff', '--name-only', '--diff-filter=d', against], root);
    if (diff) lines(diff).forEach((f) => found.add(f));
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

// Un archivo que alguna etapa sabe revisar y que es del usuario. El recorrido de respaldo ya
// aplicaba estas dos reglas; la ruta de git devolvía todo lo que git nombrara, y esa asimetría se
// notaba en dos sitios:
//
//   - `.chalc/` no está trackeado, así que `git status` lo listaba: la evidencia que el portón
//     acababa de escribir contaba como archivo cambiado, siempre con fecha posterior a sí misma.
//   - `tasks.md` sí está trackeado: marcar un checkbox invalidaba la medida que acababa de
//     autorizar ese marcado.
//
// Los dos los destapó el advisor de la spec 008 al recorrer el ciclo en un repo real.
const isUserSource = (file) => !file.startsWith('.chalc/') && SOURCE_FILE.test(file);

// El punto del que salió la rama. Se prueban las bases habituales; la primera que exista manda.
async function mergeBase(root) {
  for (const candidate of ['develop', 'main', 'master']) {
    const base = await git(['merge-base', 'HEAD', candidate], root);
    if (base && base.trim()) return base.trim();
  }
  return '';
}
