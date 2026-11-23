// cases.mjs — el catálogo de casos de eval (spec 042, R1). Responsabilidad ÚNICA: listar, cargar y validar los
// casos. Razón de cambio: la forma de un caso.
//
// Este archivo lo emite chalc dentro de `.chalc/evals/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Cada caso es UN archivo JSON con su estado inicial dentro: así el proyecto equipado no gana tests ni código
// sueltos que su propio runner pudiera recoger. Un caso trae un encargo y una trampa conocida.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_KINDS } from './checks.mjs';

export const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'cases');
const ID = /^[a-z0-9][a-z0-9-]*$/;

const bilingual = (value) => Boolean(value) && typeof value.es === 'string' && typeof value.en === 'string' && Boolean(value.es.trim()) && Boolean(value.en.trim());
// Una ruta del estado inicial: relativa, hacia dentro, y con contenido de texto.
const safeFile = ([path, content]) => typeof content === 'string' && Boolean(path) && !path.startsWith('/') && !path.split(/[\\/]/).includes('..');
const validCheck = (check) => Boolean(check) && Boolean(check.id) && CHECK_KINDS.includes(check.kind) && Number.isFinite(check.points) && check.points > 0;

/** Por qué `found` no es un caso válido: '' si lo es, o el campo que falla. */
export function caseProblem(found) {
  if (!found || typeof found !== 'object' || Array.isArray(found)) return 'not-object';
  if (!ID.test(String(found.id ?? ''))) return 'id';
  const text = ['title', 'trap', 'prompt'].find((field) => !bilingual(found[field]));
  if (text) return text;
  const files = Object.entries(found.files && typeof found.files === 'object' ? found.files : {});
  if (!files.length || !files.every(safeFile)) return 'files';
  return Array.isArray(found.checks) && found.checks.length && found.checks.every(validCheck) ? '' : 'checks';
}

/** Los ids de los casos del catálogo, en orden. */
export async function listCases(dir = CASES_DIR) {
  let names = [];
  try { names = await readdir(dir); } catch { return []; }
  return names.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).filter((id) => ID.test(id)).sort();
}

/** El caso `id`, o null si no existe o no vale. El id es un nombre, nunca una ruta. */
export async function loadCase(id, dir = CASES_DIR) {
  if (!ID.test(String(id ?? ''))) return null;
  try {
    const found = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8'));
    return caseProblem(found) ? null : found;
  } catch { return null; }
}
