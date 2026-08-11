// next.mjs — el advisor de flujo (spec 008). Responsabilidad ÚNICA: juntar los tres módulos —leer
// el estado, decidir y redactar— y fijar el código de salida. Razón de cambio: la composición del
// advisor.
//
// Este archivo lo emite chalc dentro de `.chalc/next/`. Se ejecuta con `node .chalc/next.mjs` y se
// REGENERA al equipar el repo: no lo edites, ajusta `.chalc/gate.json`.
//
// Para qué existe: el portón ya mide, pero el ORDEN en que se usa vivía en prosa dentro del
// hand-off, y quien tenía que recordarlo era el mismo que se beneficia de olvidarlo. Aquí el
// siguiente paso sale del estado del repo: de la fecha de la evidencia, del veredicto que dejó el
// portón, de la bitácora del revisor y de los checkboxes de tasks.md. No de la memoria de nadie.
//
// El advisor NO ejecuta lo que recomienda ni toca un solo archivo (R8): observa y dice. Quien
// ejecuta es el asistente, que es también quien puede equivocarse — y por eso la siguiente consulta
// lo vuelve a mirar todo desde el disco.

import { decide } from './lib/decide.mjs';
import { commandOf } from './lib/actions.mjs';
import { reasonOf } from './lib/i18n.mjs';
import { snapshot } from './lib/snapshot.mjs';

// Las tres líneas. El orden es fijo y la de comando va siempre, aunque esté vacía: un formato que
// cambia de forma según el caso obliga a quien lo lee a adivinar, y adivinar es lo que quitamos.
export function render({ action, reason, command }) {
  return [`NEXT_ACTION: ${action}`, `REASON: ${reason}`, `COMMAND: ${command}`.trimEnd()].join('\n');
}

// El consejo para el repo en `root`. Devuelve { action, reason, command, code }.
//
// El código de salida separa dos cosas que un guion necesita distinguir: que el flujo avance
// —incluidos `done` y `blocked_config`, que son estados perfectamente sabidos— de que el advisor no
// sepa dónde está, que es el único caso que necesita a una persona (R12).
export async function advise({ root = process.cwd(), gatePath, read = snapshot } = {}) {
  const facts = await read(root);
  const { action, facts: data } = decide(facts);

  return {
    action,
    reason: reasonOf(action, data, facts.lang),
    command: commandOf(action, { ...(gatePath ? { gatePath } : {}), facts: data }),
    code: action === 'ask_human' ? 1 : 0
  };
}

// Entrada de línea de comandos. Solo corre cuando se invoca el archivo, no al importarlo desde los
// tests de chalc.
if (process.argv[1] && /next\.mjs$/.test(process.argv[1])) {
  const result = await advise({ root: process.cwd() });
  console.log(render(result));
  process.exit(result.code);
}
