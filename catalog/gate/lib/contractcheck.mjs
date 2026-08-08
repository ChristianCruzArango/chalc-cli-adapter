// contractcheck.mjs — las rutas del contrato existen en el código del repo (R8).
// Responsabilidad ÚNICA: cruzar las rutas declaradas con lo que el repo implementa.
// Razón de cambio: qué se considera evidencia de que una ruta existe.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// El contrato es lo único que back, front y móvil comparten. Cuando uno se desincroniza, el error no
// sale en sus tests —los tres están verdes— sino en integración, días después y lejos de la tarea
// que lo causó. Esta etapa lo hace visible donde se rompió.
//
// La comprobación es DELIBERADAMENTE conservadora: solo reporta lo que con certeza NO está. En un
// back de NestJS la ruta nunca aparece entera (`@Controller('carrito')` + `@Post(':id/items')`), y
// en un front se arma con la URL base y una variable. Exigir la ruta literal marcaría el contrato
// completo como ausente, y una etapa que se equivoca siempre se ignora siempre.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newestSpec } from './spec.mjs';
import { RULES } from './rules.mjs';

const CONTRACT_FILE = 'contracts/api.md';

// Solo cuenta el CÓDIGO. El contrato y el README nombran la ruta por definición: si contaran como
// implementación, la etapa se aprobaría a sí misma.
const CODE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|dart|cs|java|kt|py|go|rb|php)$/;

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'target', 'obj', 'bin', '.chalc',
  '.next', '.nuxt', '.angular', '.dart_tool', '.gradle', '.venv', 'venv', 'coverage'
]);

// Segmentos que aparecen en casi toda ruta y en casi ninguna implementación: pedirlos sería pedir
// que el código repita la forma de la URL, no que exponga el recurso.
const GENERIC = new Set(['api', 'rest', 'v1', 'v2', 'v3', 'public', 'index', 'app']);

// Los segmentos que identifican al recurso: sin parámetros (`{id}`, `:id`) ni genéricos.
function distinctive(path) {
  return path.split('/')
    .filter(Boolean)
    .filter((s) => !s.startsWith(':') && !s.startsWith('{') && !/^\d+$/.test(s))
    .filter((s) => !GENERIC.has(s.toLowerCase()));
}

// Recorre el código del repo y devuelve los segmentos de `pending` que aparecen en alguna parte.
// Va borrando lo encontrado para poder cortar el recorrido en cuanto no quede nada que buscar.
async function segmentsPresent(root, pending) {
  const present = new Set();

  async function walk(rel) {
    if (!pending.size) return;
    let entries;
    try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!pending.size) return;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(child);
        continue;
      }
      if (!CODE_FILE.test(entry.name)) continue;
      let text;
      try { text = await readFile(join(root, child), 'utf8'); } catch { continue; }
      for (const segment of [...pending]) {
        if (text.includes(segment)) { pending.delete(segment); present.add(segment); }
      }
    }
  }

  await walk('');
  return present;
}

// Comprueba el contrato del repo. `routesOf` es el extractor de rutas (la copia de `contractlint`
// en el repo equipado): se inyecta para que este módulo no dependa de dónde vive esa copia.
// Sin contrato devuelve vacío: R8 es condicional, y sin rutas declaradas no hay nada que cruzar.
export async function checkContract({ root, specDir = 'specs', role = '', routesOf }) {
  const contract = await newestSpec(root, specDir, CONTRACT_FILE);
  if (!contract) return [];

  const routes = routesOf(contract.text).map((route) => ({ ...route, segments: distinctive(route.path) }));
  const pending = new Set(routes.flatMap((r) => r.segments));
  const present = await segmentsPresent(root, pending);

  // El papel del repo viaja como dato: no es lo mismo no exponer una ruta que no consumirla, y el
  // verbo correcto lo elige el marco bilingüe según el idioma.
  return routes
    .filter((route) => route.segments.length && route.segments.some((s) => !present.has(s)))
    .map((route) => ({
      file: contract.path,
      line: route.line,
      rule: RULES.contractRouteMissing,
      data: { method: route.method, path: route.path, role, missing: route.segments.filter((s) => !present.has(s)) }
    }));
}
