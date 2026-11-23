// probes.mjs — el archivo de sondas de una spec (spec 041, R1, R4). Responsabilidad ÚNICA: leer `probes.json` y
// decir si se puede ejecutar. Razón de cambio: la forma del archivo de sondas.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Vive en el árbol del portón porque el portón lo necesita para validar la spec y no importa nada de fuera de
// sí mismo; las sondas (`.chalc/probe/`) lo toman de aquí.
//
// PURO. Una sonda dice qué se le pide al servicio levantado (una petición o un comando) y qué tiene que contestar.
// Un archivo que no se entiende NO se ejecuta a medias: se rechaza entero diciendo por qué.

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasAny = (expect, keys) => isObject(expect) && keys.some((key) => expect[key] !== undefined);
const named = (probe) => (isObject(probe) && typeof probe.name === 'string' ? probe.name.trim() : '');

// Por qué una sonda no vale, o ''. `need` es el campo que la define y `keys`, lo que puede esperar.
function probeProblem(probe, need, keys) {
  const name = named(probe);
  if (!name) return 'no-name';
  if (typeof probe[need] !== 'string' || !probe[need].trim()) return `no-${need}:${name}`;
  return hasAny(probe.expect, keys) ? '' : `no-expect:${name}`;
}

const API_KEYS = ['status', 'json', 'contains'];
const CLI_KEYS = ['exit', 'stdout', 'stderr'];
const apiOf = (p) => ({ name: p.name.trim(), method: String(p.method || 'GET').toUpperCase(), url: p.url, headers: isObject(p.headers) ? p.headers : {}, body: p.body, expect: p.expect });
const cliOf = (p) => ({ name: p.name.trim(), command: p.command, expect: p.expect });

// El primer problema del contenido ya leído, o ''.
function contentProblem(api, cli) {
  if (!api.length && !cli.length) return 'empty';
  const broken = [...api.map((p) => probeProblem(p, 'url', API_KEYS)), ...cli.map((p) => probeProblem(p, 'command', CLI_KEYS))].find(Boolean);
  if (broken) return broken;
  const names = [...api, ...cli].map(named);
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  return repeated ? `duplicate:${repeated}` : '';
}

const refusal = (problem) => ({ api: [], cli: [], problem });

/** `{ api, cli, problem }` del texto de un `probes.json`. Con problema, ninguna sonda. */
export function parseProbes(text) {
  let raw;
  try { raw = typeof text === 'string' ? JSON.parse(text) : undefined; } catch { raw = undefined; }
  if (raw === undefined) return refusal('not-json');
  const lists = [raw?.api ?? [], raw?.cli ?? []];
  if (!isObject(raw) || !lists.every(Array.isArray)) return refusal('not-object');
  const problem = contentProblem(...lists);
  return problem ? refusal(problem) : { api: lists[0].map(apiOf), cli: lists[1].map(cliOf), problem: '' };
}
