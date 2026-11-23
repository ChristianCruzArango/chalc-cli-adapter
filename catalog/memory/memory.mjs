// memory.mjs — la memoria del proyecto desde la línea de comandos (spec 015). Responsabilidad ÚNICA:
// traducir cada comando a su operación y fijar la salida. Razón de cambio: la interfaz de la memoria.
//
// Este archivo lo emite chalc dentro de `.chalc/memory/`. Se ejecuta con `node .chalc/memory.mjs` y
// se REGENERA al equipar: no lo edites.
//
// Para qué existe: el advisor ya entrega a cada tarea la memoria que le toca. Esto es para lo demás:
// buscar algo puntual fuera del ciclo, ver el detalle de una entrada, elegir conceptos al escribir una
// spec y capturar al cerrar una tarea. Va separado del advisor porque escribe, y el advisor no.

import { readMemory, compactIfNeeded } from './lib/store.mjs';
import { listConcepts, loadConcepts } from './lib/concepts.mjs';
import { capture } from './lib/capture.mjs';
import { search } from './lib/search.mjs';
import { MAX_PROMOTED, candidatesOf, setPromoted } from './lib/lessons.mjs';
import { textOf } from './lib/text.mjs';
import { loadConfig } from '../gate/lib/config.mjs';

// Una entrada en una línea corta: lo justo para decidir si pedir su detalle.
const lineOf = (e) => [e.id, e.kind, String(e.title).slice(0, 100), ...(e.files?.length ? [e.files[0]] : [])].join(' · ');

const COMMANDS = {
  async search(args, root, now, tx) {
    const found = search((await readMemory(root)).entries, args.join(' '), await loadConcepts(root));
    return { code: 0, out: found.length ? found.map(lineOf).join('\n') : tx.nothingFound };
  },
  async get([id], root, now, tx) {
    const entry = (await readMemory(root)).entries.find((e) => e.id === id);
    return entry ? { code: 0, out: JSON.stringify(entry, null, 2) } : { code: 1, out: tx.noEntry(id) };
  },
  async concepts(args, root) {
    return { code: 0, out: listConcepts(await loadConcepts(root)).join('\n') };
  },
  async capture(args, root, now, tx) {
    const { rules, decisions } = await capture(root, { now });
    return { code: 0, out: tx.captured(rules, decisions) };
  },
  // Lo que se repitió y espera a que el usuario decida si es regla de todo el equipo (spec 036, R6).
  async candidates(args, root, now, tx) {
    const found = candidatesOf((await readMemory(root)).entries);
    return { code: 0, out: found.length ? found.map((e) => `${lineOf(e)} · ×${e.seen}`).join('\n') : tx.noCandidates };
  },
  // Promover o retirar es decisión de una persona (R7): sin terminal interactiva no se hace.
  promote: (args, root, now, tx, io) => promotion(args, root, { tx, io, value: true }),
  demote: (args, root, now, tx, io) => promotion(args, root, { tx, io, value: false }),
  async compact(args, root, now, tx) {
    return { code: 0, out: (await compactIfNeeded(root)) ? tx.compacted : tx.notNeeded };
  }
};

async function promotion([id], root, { tx, io, value }) {
  if (!io.isTTY) return { code: 1, out: tx.needsTerminal };
  const problem = id ? await setPromoted(root, id, value) : 'no-entry';
  if (problem === 'full') return { code: 1, out: tx.promotedFull(MAX_PROMOTED) };
  if (problem) return { code: 1, out: tx.noEntry(id || '') };
  return { code: 0, out: value ? tx.promoted(id) : tx.demoted(id) };
}

export async function run(argv, root = process.cwd(), now = new Date(), io = { isTTY: false }) {
  const [command, ...args] = argv;
  const handler = Object.hasOwn(COMMANDS, command ?? '') ? COMMANDS[command] : null;
  // Lo que dice va en el idioma del proyecto (gate.json), como el portón.
  const tx = textOf((await loadConfig(root)).config.language);
  return handler ? handler(args, root, now, tx, io) : { code: 1, out: tx.usage };
}

// Entrada de línea de comandos. Solo corre cuando se invoca el archivo, no al importarlo.
if (process.argv[1] && /memory\.mjs$/.test(process.argv[1])) {
  const result = await run(process.argv.slice(2), process.cwd(), new Date(), { isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
  process.stdout.write(`${result.out}\n`);
  process.exit(result.code);
}
