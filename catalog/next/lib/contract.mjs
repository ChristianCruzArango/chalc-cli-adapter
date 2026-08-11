// contract.mjs — la deriva entre las copias del contrato (spec 010, R1, R5).
// Responsabilidad ÚNICA: decir si dos copias que deberían ser idénticas lo son.
// Razón de cambio: qué se considera una diferencia real.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// `chalc feature` copia el MISMO contrato dentro de la spec de cada lado. Cuando el dueño lo cambia a
// media feature, las otras copias se quedan viejas y el consumidor implementa contra algo que ya no
// existe — y se entera al integrar, porque el portón solo detecta rutas desaparecidas, no cambios de
// forma ni de código de error.
//
// La regla que sostiene todo esto es comparar el CONTENIDO y nunca la fecha: equipar reescribe
// archivos y toca mtimes. Un aviso que salta cuando no ha pasado nada se aprende a ignorar en dos
// días, y entonces no sirve para el día que sí pasa.
//
// Puro: recibe los dos textos, devuelve hechos.

// Un contrato comparable: sin diferencias que no significan nada — finales de línea de otro sistema
// operativo, espacios al final de línea y líneas en blanco sobrantes al cierre.
//
// El `\r` de los finales de Windows no necesita un paso propio: el recorte de espacios finales se lo
// lleva, porque `\r` es espacio en blanco. Tenerlo por separado era código que ningún test podía
// distinguir — la pasada de mutación lo señaló como mutante equivalente, que es su forma de decir
// "esto no hace nada".
const normalize = (text) => String(text ?? '')
  .split('\n')
  .map((line) => line.replace(/\s+$/, ''))
  .join('\n')
  .replace(/\n+$/, '');

// Cuántas líneas distinguen a dos textos. Es una medida de MAGNITUD para el motivo del advisor, no un
// diff: quien necesita saber QUÉ cambió abre el diff de verdad, que es lo que el advisor le da.
//
// Se cuenta con multiconjunto y no con conjunto: añadir una línea que ya aparecía en otro sitio —una
// línea en blanco, un `- 200 → ...` repetido— también es un cambio, y con conjuntos se perdía.
function differingLines(a, b) {
  const counts = new Map();
  for (const line of a.split('\n')) counts.set(line, (counts.get(line) || 0) + 1);
  for (const line of b.split('\n')) counts.set(line, (counts.get(line) || 0) - 1);

  return [...counts.values()].reduce((total, n) => total + Math.abs(n), 0);
}

// ¿Difieren las dos copias? Devuelve { differs, lines }.
//
// Si falta cualquiera de las dos, NO hay deriva: falta el dato, que no es lo mismo que un desacuerdo.
// Reportarlo como deriva mandaría a sincronizar contra un archivo que no existe.
export function contractDrift(mine, theirs) {
  const a = normalize(mine);
  const b = normalize(theirs);
  if (!a.trim() || !b.trim()) return { differs: false, lines: 0 };
  if (a === b) return { differs: false, lines: 0 };

  return { differs: true, lines: differingLines(a, b) };
}
