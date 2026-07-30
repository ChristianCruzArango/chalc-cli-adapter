// lib/contractlint.mjs — lint de contratos entre HUs de una corrida (spec 005, R7).
// Responsabilidad única: extraer las rutas `MÉTODO /ruta` del markdown de cada contrato y
// detectar colisiones (misma ruta y método declarados por HUs distintas). Sin IA: regex, gratis.

const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';
// MÉTODO seguido de una ruta que empieza con '/', tolerando separadores de markdown
// entre ambos: backticks, asteriscos, pipes de tabla y espacios. Ej: `- **POST** \`/api/x\``.
const ROUTE_RE = new RegExp(`\\b(${METHODS})\\b[\\s\`*|]+(/[^\\s\`*|)\\]]*)`, 'g');

// Normaliza una ruta para comparar: parámetros `:id` y `{id}` son equivalentes, y la barra
// final no cuenta ('/a/' ≡ '/a').
function normalizePath(path) {
  return path.replace(/\{[^}]*\}/g, '{}').replace(/:[^/]+/g, '{}').replace(/\/+$/, '') || '/';
}

// Extrae los pares { method, path } de un contrato markdown, sin repetir dentro del mismo
// contrato (la repetición interna es legítima: tabla + detalle de la misma ruta).
export function contractRoutes(markdown) {
  const seen = new Set();
  const routes = [];
  for (const m of String(markdown ?? '').matchAll(ROUTE_RE)) {
    const method = m[1].toUpperCase();
    const path = m[2];
    const key = method + ' ' + normalizePath(path);
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method, path });
  }
  return routes;
}

// Colisiones entre HUs: mismo método + misma ruta normalizada en contratos de ids DISTINTOS.
// contracts = [{ id, contract }]. Devuelve [{ method, path, ids }] (path: primera forma vista).
export function findDuplicateRoutes(contracts) {
  const byKey = new Map();   // 'GET /a/{}' → { method, path, ids: [] }
  for (const { id, contract } of contracts) {
    for (const { method, path } of contractRoutes(contract)) {
      const key = method + ' ' + normalizePath(path);
      const entry = byKey.get(key) || { method, path, ids: [] };
      if (!entry.ids.includes(id)) entry.ids.push(id);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].filter((e) => e.ids.length > 1);
}
