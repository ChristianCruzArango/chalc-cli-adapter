// scope.mjs — lo que una spec declara que toca (spec 033, R1). Responsabilidad ÚNICA: leer `Toca:` y
// `Depende de:` de `plan.md` y decir si dos alcances chocan o si un archivo cae dentro de uno. Razón de cambio:
// cómo se declara y se compara el alcance.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO. De aquí salen dos cosas: qué specs pueden trabajarse a la vez (las que no chocan) y si una entrega se
// quedó en lo que su plan declaró.

// Una línea `Toca: …` o `Depende de: …`, con o sin viñeta y negrita. Tiene que EMPEZAR por la etiqueta.
const LABEL = /^\s*(?:[-*]\s+)?\**\s*(toca|touches|depende de|depends on)\s*:\s*\**\s*(.*)$/i;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NOTHING = new Set(['', '-', '—', 'ninguna', 'ninguno', 'nada', 'none', 'n/a']);

/** Una ruta o patrón en su forma canónica: con `/`, sin `./` delante ni `/` detrás. */
export const normalPath = (path) => String(path).trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');

// El valor de un elemento: sin comillas invertidas y sin el comentario que lo siga. Un hueco de plantilla no cuenta.
function itemOf(raw) {
  const value = raw.trim().replace(/`/g, '').split(/\s/)[0] || '';
  return value.includes('<') || NOTHING.has(value.toLowerCase()) ? '' : normalPath(value);
}

// Las viñetas que siguen a la línea `index`, saltando las líneas en blanco, hasta la primera que no lo es.
function bulletsAfter(lines, index) {
  const items = [];
  for (const line of lines.slice(index + 1)) {
    if (!line.trim()) continue;
    const bullet = BULLET.exec(line);
    if (!bullet || LABEL.test(line)) break;
    items.push(bullet[1]);
  }
  return items;
}

/** { touches, dependsOn } de un `plan.md`. Sin declararlas, listas vacías. */
export function planScope(planText) {
  const lines = String(planText ?? '').split(/\r?\n/);
  const scope = { touches: [], dependsOn: [] };
  lines.forEach((line, index) => {
    const label = LABEL.exec(line);
    if (!label) return;
    const raw = label[2].trim() ? label[2].split(',') : bulletsAfter(lines, index);
    const items = raw.map(itemOf).filter(Boolean);
    if (/^(toca|touches)$/i.test(label[1])) scope.touches.push(...items);
    // Una dependencia es el nombre de la carpeta, se escriba con `specs/` delante o sin él.
    else scope.dependsOn.push(...items.map((item) => item.split('/').pop()));
  });
  return scope;
}

// Los segmentos fijos de un patrón: hasta el primero que lleva comodín.
export function fixedPrefix(pattern) {
  const parts = normalPath(pattern).split('/').filter(Boolean);
  const wild = parts.findIndex((part) => part.includes('*'));
  return wild < 0 ? parts : parts.slice(0, wild);
}

/** ¿Pueden dos patrones cubrir un mismo archivo? Sí cuando el prefijo fijo de uno contiene al del otro. */
export function overlaps(a, b) {
  const [short, long] = [fixedPrefix(a), fixedPrefix(b)].sort((x, y) => x.length - y.length);
  return short.every((part, index) => part === long[index]);
}

// El patrón como expresión regular: `**` cruza carpetas, `*` no; todo lo demás es literal.
function globRegex(pattern) {
  const body = pattern.split('**').map((piece) => piece.split('*').map((text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${body}$`);
}

/** ¿Cubre algún patrón de `patterns` a `file`? Un patrón sin comodín cubre esa ruta y lo que cuelga de ella. */
export function inScope(file, patterns) {
  const path = normalPath(file);
  return patterns.map(normalPath).some((pattern) => (pattern.includes('*') ? globRegex(pattern).test(path) : path === pattern || path.startsWith(`${pattern}/`)));
}
