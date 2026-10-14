// cli/engine/neartools.mjs — resolución de nombres de tool que NO existen. Los modelos locales truncan
// o mal escriben nombres largos (mcp__server__tool); cada heurística es una función pura y aislada, y
// `nearTools` las compone en orden. Solo PREFIJOS y con mínimo 4 caracteres: con contención
// ("includes") un nombre corto inventado ("sh", "it") se resolvería a una tool DISTINTA (bash, edit) y
// el agente ejecutaría algo que el modelo no pidió.

const MIN_NAME = 4;
const BASICS = ['write', 'edit', 'bash'];

// Nombre TRUNCADO de una tool MCP (el modelo escribió el principio de un nombre largo). La otra
// dirección —un nombre más largo que empieza por el de una tool— convertía `editor_x` en `edit`.
export function truncatedMcpNames(names, tool) {
  if (tool.length < MIN_NAME) return [];
  return names.filter((n) => n.startsWith('mcp__') && n.startsWith(tool));
}

// Sufijo único: solo el nombre de la tool sin el prefijo del server
// ("get_best_practices" → "mcp__angular-cli__get_best_practices").
export function uniqueSuffixName(names, tool) {
  if (tool.length < MIN_NAME) return [];
  const bySuffix = names.filter((n) => n.endsWith(`__${tool}`));
  return bySuffix.length === 1 ? bySuffix : [];
}

// Namespace inventado con punto/slash (gpt-oss alucina "repo_browser.list", "functions.write"): si el
// ÚLTIMO segmento coincide EXACTO con una tool disponible, la intención es inequívoca.
export function namespaceTailName(names, tool) {
  if (!/[./]/.test(tool)) return [];
  const tail = tool.split(/[./]/).pop();
  return names.includes(tail) ? [tail] : [];
}

// Varios candidatos (típico: solo "mcp__<server>"): si las claves de los args encajan en el esquema
// (argHints) de UNA sola candidata, es esa; si no, se devuelven las mismas candidatas.
export function narrowByArgs(tools, near, args) {
  const keys = Object.keys(args || {});
  if (!keys.length) return near;
  const fits = near.filter((n) => Array.isArray(tools[n]?.argHints) && keys.every((k) => tools[n].argHints.includes(k)));
  return fits.length === 1 ? fits : near;
}

// Las candidatas para `turn.tool`: la primera heurística que da UNA sola gana; con varias, se
// desambigua por los args. Devuelve las candidatas (una = resolución automática).
const unlessResolved = (near, next) => (near.length !== 1 && next.length ? next : near);

export function nearTools(tools, turn) {
  const names = Object.keys(tools);
  let near = truncatedMcpNames(names, turn.tool);
  near = unlessResolved(near, uniqueSuffixName(names, turn.tool));
  near = unlessResolved(near, namespaceTailName(names, turn.tool));
  // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalentes — con 0 o 1 candidata narrowByArgs devuelve la misma
  return near.length > 1 ? narrowByArgs(tools, near, turn.args) : near;
}

// La pista de la observación. Con candidatos, un ejemplo COPIABLE (los modelos locales imitan mejor un
// nombre completo que una lista). Sin candidatos, el modelo INVENTÓ la tool: se redirige SOLO a
// alternativas que existen aquí; pedir write/edit/bash en un rol de solo lectura significa que intenta
// EJECUTAR cuando su entregable es el done.summary.
export function unknownToolHint(tools, tool, near) {
  if (near.length) return `. The name is incomplete: use the FULL exact name, e.g. "${near[0]}"`;
  const basics = BASICS.filter((n) => n in tools);
  if (BASICS.includes(tool) && !basics.length) {
    return '. You are in a READ-ONLY role: do NOT execute changes; explore with read/list/grep and deliver your result with {"done":true,"summary":"..."}';
  }
  return `. That tool does NOT exist: pick EXACTLY one from "available"${basics.length ? `, or do it with ${basics.join('/')}` : ''}`;
}
