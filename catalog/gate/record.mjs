// record.mjs — el anotador de rutas escritas (spec 013, R10b). Responsabilidad ÚNICA: convertir el
// evento de un hook en una anotación en el registro de la tarea. Razón de cambio: de qué formas
// llega una ruta desde un asistente externo.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/`. Se invoca desde un hook del asistente:
//
//   node .chalc/gate/record.mjs
//
// Para qué existe: el registro de rutas escritas es la fuente precisa del alcance —la única que
// distingue "lo que hice en esta tarea" de "lo que había suelto en el árbol"—, y hasta ahora solo
// sabía llenarlo el harness propio de chalc. Con Claude Code o Codex al volante no había registro y
// el alcance caía al diff. Eso duele especialmente en el flujo normal de este método, donde se
// commitea al final: la línea base es un commit, así que sin commits el diff no separa una tarea de
// la anterior. El registro sí.
//
// Es deliberadamente tonto: recibe un evento, saca la ruta, la anota. Decidir qué se revisa es de
// `scope.mjs`, y meter criterio aquí sería tener dos sitios donde se decide lo mismo.

import { isAbsolute, relative, resolve } from 'node:path';
import { isUserSource } from './lib/sources.mjs';
import { recordTouched } from './lib/touched.mjs';
import { readStdin } from './lib/stdin.mjs';

// Las claves con las que los asistentes nombran "el archivo sobre el que actué". No hay estándar
// entre ellos, y aceptar las formas conocidas sale más barato que un anotador por target —y es más
// honesto que fingir que solo existe uno—.
const PATH_KEYS = ['file_path', 'filePath', 'path'];

// Herramientas que ESCRIBEN. Leer no cuenta: si las lecturas entraran, el alcance incluiría todo lo
// que el asistente miró de pasada, que es medio repo — el problema original de vuelta.
const WRITES = /^(?:write|edit|multiedit|create|update|apply_patch|str_replace|notebookedit)/i;

// Las rutas que un evento de hook dice haber escrito. Un evento ilegible o que no escribió nada
// devuelve []: el hook corre dentro del turno del asistente y no puede tumbarlo.
export function pathsIn(payload) {
  let event;
  try { event = JSON.parse(String(payload ?? '')); } catch { return []; }
  if (!event || typeof event !== 'object') return [];

  const tool = String(event.tool_name ?? event.tool ?? '').replace(/[\s_-]/g, '');
  if (!WRITES.test(tool)) return [];

  // Se quedan TODAS las claves que traigan ruta, no solo la primera. Había un `.slice(0, 1)` aquí y
  // la pasada de mutación lo señaló: ningún test lo distinguía, y mirándolo no defendía nada — dos
  // claves del mismo evento apuntan al mismo archivo, y el lector del registro ya deduplica.
  const input = event.tool_input || event.input || {};
  return PATH_KEYS.map((key) => input[key]).filter((value) => typeof value === 'string' && value.trim());
}

// Una ruta relativa al proyecto, o '' si no le pertenece. Un asistente escribe también fuera del
// repo —su propia config, un temporal—, y eso no es trabajo de la tarea: el portón solo sabe revisar
// dentro del proyecto.
function inside(root, path) {
  const full = isAbsolute(path) ? path : resolve(root, path);
  const rel = relative(resolve(root), full).replace(/\\/g, '/');
  return rel && !rel.startsWith('../') ? rel : '';
}

// Anota lo que el evento diga haber escrito. `argv` es la puerta para quien no pueda dar el evento
// entero y sí la ruta.
export async function recordEvent(root, { argv = [], stdin = '' } = {}) {
  const paths = [...argv, ...pathsIn(stdin)]
    .map((path) => inside(root, path))
    .filter((path) => path && isUserSource(path));

  await recordTouched(root, paths);
  return paths;
}

// Entrada de línea de comandos. La raíz la da Claude Code en `CLAUDE_PROJECT_DIR`, como en la guarda y en el
// registro del tablero: la shell puede estar en una subcarpeta, y desde ahí todo quedaría «fuera». Sale SIEMPRE con 0: un hook que falla interrumpe al asistente, y
// quedarse sin registro solo significa que el alcance cae al diff —que revisa de más, no de menos—.
// `main` recibe argv, entorno, carpeta y lector de stdin para poder probarse sin lanzar el hook.
export async function main({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), read = readStdin } = {}) {
  try {
    // Solo se lee stdin sin rutas por argumento: con ellas nadie la cierra (ver `lib/stdin.mjs`).
    return await recordEvent(env.CLAUDE_PROJECT_DIR || cwd, { argv, stdin: argv.length ? '' : await read() });
  } catch { return []; /* anotar nunca puede romper el turno de quien está trabajando */ }
}

if (process.argv[1] && /record\.mjs$/.test(process.argv[1])) {
  await main();
  process.exit(0);
}
