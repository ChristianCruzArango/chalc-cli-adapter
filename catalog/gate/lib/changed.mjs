// changed.mjs — los archivos que la tarea tocó. Responsabilidad ÚNICA: decir sobre qué se revisa.
// Razón de cambio: cómo se determina el alcance de una tarea.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Acotar a lo cambiado es lo que hace usable al portón: en un repo con historia, revisar el árbol
// entero produciría cientos de hallazgos que nadie va a mirar, y la tarea de hoy quedaría enterrada
// entre deuda de hace tres años.

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Extensiones que alguna etapa sabe revisar. Lo demás no entra en el recorrido de respaldo.
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|dart|cs|java|kt|py)$/;

const SKIP_DIRS = new Set([
  '.git', '.chalc', 'node_modules', 'dist', 'build', 'out', 'target', 'obj', 'bin',
  '.next', '.nuxt', '.angular', '.dart_tool', '.gradle', '.venv', 'venv', 'coverage'
]);

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

// Todos los fuentes del proyecto, en rutas relativas con '/'. Es el respaldo cuando no hay git.
async function allSources(root, rel = '') {
  const found = [];
  let entries;
  try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) found.push(...await allSources(root, child));
    } else if (SOURCE_FILE.test(entry.name)) found.push(child);
  }
  return found;
}

// Archivos cambiados respecto a la base de la rama, más lo que aún no está commiteado. Rutas
// relativas con '/'.
//
// SIN GIT se revisa el árbol de fuentes entero. Devolver [] sería decir "no hay nada que revisar", y
// el portón aprobaría en silencio un repo que nunca miró — que es justo lo que esta spec quita. Con
// git y sin cambios, [] sí es la respuesta correcta: no se tocó nada.
export async function changedFiles(root, { base = '' } = {}) {
  if (!await git(['rev-parse', '--is-inside-work-tree'], root)) return (await allSources(root)).sort();

  const found = new Set();

  const against = base || await mergeBase(root);
  if (against) {
    const diff = await git(['diff', '--name-only', '--diff-filter=d', against], root);
    if (diff) lines(diff).forEach((f) => found.add(f));
  }

  // Lo que está en el árbol de trabajo y todavía no se commiteó: es justo lo que se acaba de hacer.
  const status = await git(['status', '--porcelain'], root);
  if (status) {
    for (const line of lines(status)) {
      const path = line.replace(/^\S+\s+/, '').split(' -> ').pop();
      if (path) found.add(path);
    }
  }

  return [...found].map((f) => f.replace(/\\/g, '/')).sort();
}

// El punto del que salió la rama. Se prueban las bases habituales; la primera que exista manda.
async function mergeBase(root) {
  for (const candidate of ['develop', 'main', 'master']) {
    const base = await git(['merge-base', 'HEAD', candidate], root);
    if (base && base.trim()) return base.trim();
  }
  return '';
}
