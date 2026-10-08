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

const USAGE = [
  'Uso:',
  '  node .chalc/memory.mjs search <palabras>   reglas y decisiones que responden (como mucho 8)',
  '  node .chalc/memory.mjs get <id>            el detalle completo de una entrada',
  '  node .chalc/memory.mjs concepts            los conceptos existentes, para escribir una spec',
  '  node .chalc/memory.mjs capture             guarda lo aprendido al cerrar una tarea',
  '  node .chalc/memory.mjs compact             deja solo la versión vigente de cada entrada'
].join('\n');

// Una entrada en una línea corta: lo justo para decidir si pedir su detalle.
const lineOf = (e) => [e.id, e.kind, String(e.title).slice(0, 100), ...(e.files?.length ? [e.files[0]] : [])].join(' · ');

const COMMANDS = {
  async search(args, root) {
    const found = search((await readMemory(root)).entries, args.join(' '), await loadConcepts(root));
    return { code: 0, out: found.length ? found.map(lineOf).join('\n') : 'Nada en la memoria sobre eso.' };
  },
  async get([id], root) {
    const entry = (await readMemory(root)).entries.find((e) => e.id === id);
    return entry ? { code: 0, out: JSON.stringify(entry, null, 2) } : { code: 1, out: `No hay ninguna entrada con id ${id}.` };
  },
  async concepts(args, root) {
    return { code: 0, out: listConcepts(await loadConcepts(root)).join('\n') };
  },
  async capture(args, root, now) {
    const { rules, decisions } = await capture(root, { now });
    return { code: 0, out: `Memoria: ${rules} regla(s) y ${decisions} decisión(es) capturadas.` };
  },
  async compact(args, root) {
    return { code: 0, out: (await compactIfNeeded(root)) ? 'Memoria compactada.' : 'No hacía falta compactar.' };
  }
};

export async function run(argv, root = process.cwd(), now = new Date()) {
  const [command, ...args] = argv;
  const handler = Object.hasOwn(COMMANDS, command ?? '') ? COMMANDS[command] : null;
  return handler ? handler(args, root, now) : { code: 1, out: USAGE };
}

// Entrada de línea de comandos. Solo corre cuando se invoca el archivo, no al importarlo.
if (process.argv[1] && /memory\.mjs$/.test(process.argv[1])) {
  const result = await run(process.argv.slice(2), process.cwd());
  process.stdout.write(`${result.out}\n`);
  process.exit(result.code);
}
