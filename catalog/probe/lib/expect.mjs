// expect.mjs — comparar lo que llegó con lo que se esperaba (spec 041, R2, R3). Responsabilidad ÚNICA: decir en
// qué difiere la respuesta de una sonda. Razón de cambio: qué se puede esperar de una respuesta.
//
// Este archivo lo emite chalc dentro de `.chalc/probe/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO. Cada diferencia dice QUÉ se miró, qué se esperaba y qué llegó. Del JSON se compara un subconjunto: lo
// que la sonda nombra tiene que estar y valer eso; lo demás no importa. `"*"` acepta cualquier valor presente.

const ANY = '*';
const isContainer = (value) => Boolean(value) && typeof value === 'object';
const listOf = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const mismatch = (what, expected, actual) => ({ what, expected, actual });

// Las diferencias entre lo esperado y lo que hay en `actual`, bajando por objetos y listas.
function differences(expected, actual, path) {
  if (expected === ANY) return actual === undefined ? [mismatch(path, expected, actual)] : [];
  if (!isContainer(expected)) return Object.is(expected, actual) ? [] : [mismatch(path, expected, actual)];
  const inside = isContainer(actual) ? actual : {};
  return Object.keys(expected).flatMap((key) => differences(expected[key], inside[key], `${path}.${key}`));
}

function jsonMismatches(expected, body) {
  let parsed;
  try { parsed = JSON.parse(body); } catch { return [mismatch('json', 'JSON', String(body).slice(0, 200))]; }
  return differences(expected, parsed, 'json');
}

// Cada texto que debía aparecer en `output` y no está.
const missingIn = (what, wanted, output, shown) => listOf(wanted).filter((text) => !String(output).includes(text)).map((text) => mismatch(what, text, shown));

/** En qué difiere la respuesta `{ status, body }` de lo que espera una sonda de API. Vacío si cumple. */
export function apiMismatches(expect, { status, body }) {
  return [
    ...(expect.status !== undefined && expect.status !== status ? [mismatch('status', expect.status, status)] : []),
    ...(expect.json !== undefined ? jsonMismatches(expect.json, body) : []),
    ...missingIn('contains', expect.contains, body, '')
  ];
}

/** En qué difiere el resultado `{ exit, stdout, stderr }` de lo que espera una sonda de CLI. Vacío si cumple. */
export function cliMismatches(expect, { exit, stdout, stderr }) {
  return [
    ...(expect.exit !== undefined && expect.exit !== exit ? [mismatch('exit', expect.exit, exit)] : []),
    ...missingIn('stdout', expect.stdout, stdout, stdout),
    ...missingIn('stderr', expect.stderr, stderr, stderr)
  ];
}
