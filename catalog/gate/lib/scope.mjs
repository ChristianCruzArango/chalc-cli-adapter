// scope.mjs — la política de alcance de una tarea (spec 013, R10/R12). Responsabilidad ÚNICA:
// decidir qué archivos se revisan a partir de las fuentes disponibles. Razón de cambio: el orden de
// precedencia entre esas fuentes.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// La regla, en una frase: se revisa lo que la tarea modificó, nunca el proyecto. El diff no sabe de
// tareas —ve un árbol con cambios y no distingue los de esta tarea de los que ya estaban a medias—,
// así que cuando alguien anotó lo que escribió (R10), esa lista MANDA y el diff pasa a respaldo.
//
// Puro a propósito: recibe listas, devuelve el alcance. Quien las obtiene —git, el registro— es
// `taskScope`. Así la política se prueba rama por rama sin repos ni fixtures, que es lo que permite
// que las decisiones peligrosas de aquí abajo estén todas cubiertas.
//
// La otra regla, transversal: NADA sale del alcance en silencio. Lo que el diff traía y el registro
// dejó fuera va en `excluded`; lo que se escribió y luego se deshizo, en `reverted`. Un alcance
// estrecho sin declarar se lee igual que «no había nada», que es la mentira que esta spec vino a
// quitar.

import { isUserSource } from './sources.mjs';

// Rutas utilizables: normalizadas, sin duplicados, sin lo que ninguna etapa sabe revisar, ordenadas.
// El mismo filtro para las dos fuentes: si no fuera el mismo, el alcance dependería de por dónde
// llegó cada archivo.
const usable = (paths) => [...new Set(
  (paths || []).map((p) => String(p ?? '').replace(/\\/g, '/').trim()).filter(Boolean)
)].filter(isUserSource).sort();

const without = (from, others) => from.filter((f) => !others.includes(f));

// El alcance a partir de las dos fuentes.
//
// `diff` es `null` cuando no se pudo calcular —sin repo, o con una referencia que no resuelve—, que
// NO es lo mismo que `[]`. Aquí esa diferencia decide si el registro se contrasta o se respeta
// entero; en `taskScope` decide si la corrida se bloquea (R4b).
//
// `diffSource` dice contra qué se midió el diff, para que la evidencia pueda declararlo (R7). Solo
// se usa cuando el diff manda: con registro, la procedencia es el registro.
export function resolveScope({ registry = [], diff = null, diffSource = 'baseline' } = {}) {
  const written = usable(registry);
  const changed = diff === null ? null : usable(diff);

  // Sin nada anotado no hay nada que preferir. Un registro que se queda vacío al filtrar —alguien
  // anotó solo un README— es lo mismo que no tenerlo: lo contrario daría un alcance vacío, y R13
  // prohíbe que un alcance vacío pase por aprobado.
  //
  // Y sin diff tampoco, no queda fuente ninguna: el alcance no se puede fijar (R4b). Eso NO es un
  // alcance vacío. Un alcance vacío se puede informar —"no cambió nada"—; este hay que bloquearlo,
  // porque la alternativa histórica era revisar el proyecto entero y llamarlo revisión.
  if (!written.length) {
    if (changed === null) return { files: [], source: 'none', excluded: [], reverted: [], undetermined: true };
    return { files: changed, source: diffSource, excluded: [], reverted: [], undetermined: false };
  }

  // Sin diff con el que contrastar, el registro se respeta entero. Recortarlo sería recortar a
  // ciegas, y dejar trabajo sin revisar pesa más que revisar un archivo intacto. El alcance está
  // determinado igual: quien escribió lo anotó, y para eso se anota.
  if (changed === null) {
    return { files: written, source: 'registry', excluded: [], reverted: [], undetermined: false };
  }

  // Lo escrito y luego deshecho tiene el contenido de la línea base: revisarlo devolvería deuda
  // vieja con nombre de hallazgo nuevo.
  return {
    files: written.filter((f) => changed.includes(f)),
    source: 'registry',
    excluded: without(changed, written),
    reverted: without(written, changed),
    // Que no quede nada que revisar porque todo se deshizo es un hecho SABIDO, no una duda: se
    // informa, no se bloquea.
    undetermined: false
  };
}
