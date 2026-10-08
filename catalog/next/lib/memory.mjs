// memory.mjs — la memoria del proyecto, en LECTURA (spec 015, R15, R18, R19). Responsabilidad ÚNICA:
// decir qué entradas de memoria le tocan a la tarea en curso y si siguen vigentes. Razón de cambio:
// de dónde salen esas entradas.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: se regenera al equipar.
//
// El advisor es un observador: aquí solo se lee. Escribir la memoria es de `.chalc/memory.mjs`. Y
// cualquier fallo —memoria no emitida, ilegible, sin git— devuelve «sin memoria»: es un canal que
// ayuda, y no puede tumbar el ciclo.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { changedSince } from '../../gate/lib/changed.mjs';
import { newestSpec } from '../../gate/lib/spec.mjs';

// La memoria se importa al usarla, no al cargar el advisor. Un repo equipado sin `.chalc/memory/`
// —una versión anterior de chalc, una copia a medias— tumbaría el advisor entero con un import
// estático; así solo se queda sin memoria.
const memoryLib = async () => Promise.all([
  import('../../memory/lib/store.mjs'),
  import('../../memory/lib/concepts.mjs'),
  import('../../memory/lib/recall.mjs')
]);

const NONE = { concepts: [], entries: [] };

// ¿Cambió el código de la entrada desde que se aprendió? Archivos que ya no existen, o que el diff
// desde su commit nombra. Sin commit no se puede saber, y no se marca: marcar de más enseñaría a
// ignorar la marca.
async function staleness(root, entries) {
  const changedBy = new Map();
  for (const commit of new Set(entries.map((e) => e.commit).filter(Boolean))) {
    changedBy.set(commit, new Set((await changedSince(root, commit)) || []));
  }
  return entries.map((e) => e.files.some((f) => !existsSync(join(root, f)) || changedBy.get(e.commit)?.has(f)));
}

// Las entradas que le tocan a `task`, ya marcadas: [{ id, kind, title, files, learned, stale }].
export async function readMemoryFacts(root, { specDir = 'specs', task = '', findSpec = newestSpec } = {}) {
  try {
    const [{ readMemory }, { loadConcepts }, { recall, taskConcepts }] = await memoryLib();
    const { entries } = await readMemory(root);
    if (!entries.length) return { ...NONE };

    const spec = await findSpec(root, specDir, 'spec.md');
    const concepts = taskConcepts({ task, spec: spec?.text || '', concepts: await loadConcepts(root) });
    const chosen = recall(entries, concepts).map((e) => ({ ...e, files: e.files || [] }));
    const stale = await staleness(root, chosen);

    return {
      concepts,
      entries: chosen.map((e, i) => ({ id: e.id, kind: e.kind, title: e.title, files: e.files, learned: e.learned, stale: stale[i] }))
    };
  } catch {
    return { ...NONE };
  }
}
