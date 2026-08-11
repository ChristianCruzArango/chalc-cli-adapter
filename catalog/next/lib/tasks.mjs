// tasks.mjs — la lectura de `tasks.md` (spec 008, R21). Responsabilidad ÚNICA: convertir el
// markdown de tareas en progreso, tarea en curso y texto legible. Razón de cambio: qué cuenta como
// tarea y cómo se presenta.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Vive en el catálogo, no en `lib/`, porque lo necesitan DOS consumidores: el advisor —que decide
// con él dentro del repo equipado— y el dashboard de la spec 006, que lo re-exporta. Dos lecturas
// distintas de lo que es un checkbox harían que el dashboard mostrara un progreso y el advisor
// creyera otro. Mismo criterio que la spec 007 aplicó a los linters de fronteras y contrato.
//
// Todo aquí es puro: recibe markdown, devuelve datos. Quien lee el archivo es `snapshot.mjs`.

// Progreso: checkboxes marcados / totales (listas con - o *). Vacío → 0/0.
export function tasksProgress(markdown) {
  const boxes = String(markdown ?? '').match(/^\s*[-*]\s*\[[ xX]\]/gm) || [];
  const done = boxes.filter((b) => /\[[xX]\]/.test(b)).length;
  return { done, total: boxes.length };
}

// La tarea EN CURSO: texto de la PRIMERA pendiente. Todo hecho o vacío → ''. Ese vacío es la señal
// de "feature terminada" que el advisor usa para `done`, así que no puede significar otra cosa.
export function currentTask(markdown) {
  const m = String(markdown ?? '').match(/^\s*[-*]\s*\[ \]\s*(.+)$/m);
  return m ? m[1].trim() : '';
}

// Recorte con elipsis para mostrar en columnas (tareas y asuntos de commit largos).
const trunc = (s, max) => (String(s ?? '').length > max ? String(s).slice(0, max - 1).trimEnd() + '…' : String(s ?? ''));

// Limpia el texto de una tarea para MOSTRARLO: fuera marcas markdown (**, `, [P], _…_), espacios
// colapsados y truncado a un largo legible — nunca el párrafo crudo del tasks.md.
export function cleanTaskText(text, max = 76) {
  return trunc(String(text ?? '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[P\]\s*/gi, '')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim(), max);
}
