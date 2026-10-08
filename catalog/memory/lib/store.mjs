// store.mjs — el almacén de la memoria (spec 015, R1–R3). Responsabilidad ÚNICA: leer y escribir
// `.chalc/memory/memory.jsonl`. Razón de cambio: el formato del almacén.
//
// Este archivo lo emite chalc dentro de `.chalc/memory/lib/`. No edites aquí: se regenera al equipar.
//
// Una línea JSON por entrada, y solo añadiendo. Lo escriben procesos distintos —la captura al cerrar
// una tarea, un equipo que trae memoria por git— y un archivo que se reescribe entero pierde entradas
// cuando dos escriben a la vez. Actualizar una entrada es añadir su versión nueva: al leer, la última
// línea de cada clave es la vigente. Compactar es lo único que reescribe, y solo cuando sobra la mitad.

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const MEMORY_REL = '.chalc/memory/memory.jsonl';

// El id sale de la clave: una lección conserva su id aunque se actualice, y `get <id>` la encuentra.
const idOf = (key) => createHash('sha256').update(key).digest('hex').slice(0, 8);

const union = (a = [], b = []) => [...new Set([...a, ...b])];

const pathOf = (root) => join(root, MEMORY_REL);

// Una línea como entrada, o null. Una línea rota —un proceso que murió a mitad de escribir— no es
// una entrada: no puede tumbar la memoria entera.
const parseLine = (line) => {
  try { return JSON.parse(line); } catch { return null; }
};

// Las entradas legibles del texto, en orden.
const parseLines = (text) => text.split('\n')
  .filter((line) => line.trim())
  .map(parseLine)
  .filter((entry) => entry && typeof entry.key === 'string' && entry.key);

// La versión vigente de cada clave: la última línea que la nombra.
// La versión vigente de cada clave. `seen` se SUMA: cada `remember` añade una línea con `inc: 1` en vez
// de un total, porque dos procesos que leían el mismo total y escribían total+1 perdían una cuenta.
// Una línea sin `inc` (las antiguas, o la que deja la compactación) trae el total absoluto.
const latest = (entries) => {
  const byKey = new Map();
  for (const e of entries) {
    const seen = typeof e.inc === 'number' ? (byKey.get(e.key)?.seen ?? 0) + e.inc : (e.seen ?? 0);
    const { inc, ...rest } = e;
    byKey.set(e.key, { ...byKey.get(e.key), ...rest, seen });
  }
  return [...byKey.values()];
};

// Las entradas vigentes y cuántas líneas tiene el archivo (lo que decide si conviene compactar).
export async function readMemory(root) {
  let text;
  try { text = await readFile(pathOf(root), 'utf8'); } catch { return { entries: [], lines: 0 }; }
  const all = parseLines(text);
  return { entries: latest(all), lines: all.length };
}

// Guarda `entry`. Si su clave ya existe, la actualiza: suma una vez vista, une los archivos y toma el
// resto de los datos nuevos. `learned` es cuándo se aprendió por primera vez y no cambia; `date`, la
// última vez que se vio. Devuelve la entrada tal como quedó.
export async function remember(root, entry, { now = new Date() } = {}) {
  if (!entry?.key) throw new Error('una entrada de memoria necesita clave');

  const { entries } = await readMemory(root);
  const current = entries.find((e) => e.key === entry.key);
  const saved = {
    ...current,
    ...entry,
    id: idOf(entry.key),
    files: union(current?.files, entry.files),
    seen: (current?.seen ?? 0) + 1,
    learned: current?.learned ?? now.toISOString(),
    date: now.toISOString()
  };

  await mkdir(dirname(pathOf(root)), { recursive: true });
  // Se escribe el incremento, no el total (ver `latest`); lo devuelto lleva el total para quien llama.
  const { seen, ...line } = saved;
  await appendFile(pathOf(root), JSON.stringify({ ...line, inc: 1 }) + '\n', 'utf8');
  return saved;
}

// Reescribe el archivo con solo las versiones vigentes cuando las líneas superan el doble de las
// entradas. Devuelve si compactó. Se escribe aparte y se renombra: o queda el archivo viejo o el
// nuevo, nunca uno a medias.
export async function compactIfNeeded(root) {
  const { entries, lines } = await readMemory(root);
  if (!lines || lines <= entries.length * 2) return false;

  // Nombre único: con uno fijo, dos procesos compactando a la vez escribían el mismo temporal.
  const tmp = `${pathOf(root)}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  await rename(tmp, pathOf(root));
  return true;
}
