// hunks.mjs — las LÍNEAS que la tarea escribió. Responsabilidad ÚNICA: decir, dentro de cada
// archivo del alcance, qué líneas son nuevas. Razón de cambio: cómo se lee un diff.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// El alcance por archivo no basta. Una tarea que añade dos líneas a un archivo de cuatrocientas lo
// mete entero en la revisión, y con él todos los hallazgos y mutantes que ya vivían ahí. Medido en
// una feature real: 132 de 139 mutantes supervivientes eran de código que la tarea no escribió. Ese
// ruido tiene dos efectos, los dos malos: el portón no puede pasar en un repo con historia, y el
// camino más corto para subir el número es escribir pruebas de relleno sobre código ajeno.
//
// Puro a propósito: recibe el texto de un diff, devuelve posiciones. Quien llama a git es `changed.mjs`.

// Cabecera de archivo destino: `+++ b/src/precio.ts`.
const FILE = /^\+{3} (?:b\/)?(.+)$/;

// Cabecera de bloque: `@@ -10,3 +11,4 @@`. El primer par es el del archivo VIEJO y el segundo el
// del NUEVO. Para saber qué se revisa basta el segundo; el primero hace falta para reconstruir el
// tamaño que tenía el archivo antes de la tarea.
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// Cuántas líneas declara un lado de la cabecera. Sin conteo explícito, el bloque es de una línea.
const sizeOf = (count) => (count === undefined ? 1 : Number(count));

const normalise = (path) => String(path ?? '').replace(/\\/g, '/').trim();

// Líneas nuevas por archivo, a partir de un diff unificado con `-U0`.
// Devuelve Map<archivo, Set<línea>>.
export function parseHunks(diffText) {
  const byFile = new Map();
  let current = null;

  for (const raw of String(diffText ?? '').split(/\r?\n/)) {
    const file = FILE.exec(raw);
    if (file) {
      current = normalise(file[1]);
      if (current === '/dev/null') { current = null; continue; }
      if (!byFile.has(current)) byFile.set(current, new Set());
      continue;
    }

    const hunk = HUNK.exec(raw);
    if (!hunk || !current) continue;

    const start = Number(hunk[3]);
    // Con `0` no hay ninguna línea nueva: el bloque solo borró.
    const count = sizeOf(hunk[4]);
    const lines = byFile.get(current);
    for (let i = 0; i < count; i++) lines.add(start + i);
  }

  return byFile;
}

// Cuántas líneas borró la tarea de cada archivo. Devuelve Map<archivo, número>.
//
// Hace falta para reconstruir el tamaño que el archivo tenía ANTES: hoy menos las añadidas más las
// borradas. Sin las borradas, un archivo de 301 líneas al que se le cambia una por tres parece que
// medía 300 —justo el límite—, y la deuda vieja se le cobra a quien pasaba por ahí.
export function removedByFile(diffText) {
  const byFile = new Map();
  let current = null;

  for (const raw of String(diffText ?? '').split(/\r?\n/)) {
    const file = FILE.exec(raw);
    if (file) {
      current = normalise(file[1]);
      if (current === '/dev/null') { current = null; continue; }
      if (!byFile.has(current)) byFile.set(current, 0);
      continue;
    }

    const hunk = HUNK.exec(raw);
    if (!hunk || !current) continue;
    byFile.set(current, byFile.get(current) + sizeOf(hunk[2]));
  }

  return byFile;
}

// Las líneas de un archivo agrupadas en tramos contiguos: [[desde, hasta], …].
//
// Existe para poder DECIRLE a la herramienta de mutación qué medir. Stryker acepta tramos
// (`Archivo.cs{44..46}` en .NET, `a.ts:44-46` en JS), así que con esto la corrida deja de mutar el
// archivo entero: no solo es ruido menos, son minutos menos.
//
// `gap` funde tramos separados por un hueco diminuto. Mide unas pocas líneas de más a cambio de que
// el comando no crezca sin control, y errar hacia medir de MÁS es el lado seguro.
export function rangesOf(lines, { gap = 2 } = {}) {
  if (!lines || !lines.size) return [];

  const ordenadas = [...lines].map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const rangos = [];

  for (const line of ordenadas) {
    const ultimo = rangos[rangos.length - 1];
    if (ultimo && line - ultimo[1] <= gap) ultimo[1] = line;
    else rangos.push([line, line]);
  }
  return rangos;
}

// La ruta de `file` relativa a `root`, en el vocabulario del diff.
//
// Los reportes de mutación no hablan el mismo idioma que git: Stryker.NET nombra cada archivo con
// su ruta absoluta y con contrabarra. Sin traducir, ningún mutante casaría con su archivo y el
// alcance por línea no filtraría nada — que es peor que no filtrar, porque parecería que sí.
export function relativeTo(root, file) {
  const path = normalise(file);
  const base = normalise(root).replace(/\/+$/, '');
  if (!base) return path;

  // Windows no distingue mayúsculas en las rutas, y el reporte puede traer otra capitalización de
  // la unidad que la que usó git.
  return path.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? path.slice(base.length + 1) : path;
}

// ¿Escribió la tarea dentro de `from`..`to` de `file`?
//
// El tramo importa: una función que se pasó del límite es de quien añadió las líneas que la
// alargaron, aunque su cabecera lleve años ahí. Con un solo número se comprueba esa línea.
//
// Sin información de líneas para el archivo se acepta TODO. Callar hallazgos por no poder
// atribuirlos sería peor que enseñar de más: el portón existe para no aprobar lo que no miró, y un
// archivo nuevo —que no aparece en ningún diff previo— es justo el que más hay que revisar.
export function touchesChange(byFile, file, from, to = from) {
  if (!byFile || typeof byFile.get !== 'function') return true;

  const lines = byFile.get(normalise(file));
  if (!lines || !lines.size) return true;

  const start = Number(from) || 1;
  const end = Math.max(start, Number(to) || start);
  for (let i = start; i <= end; i++) if (lines.has(i)) return true;
  return false;
}
