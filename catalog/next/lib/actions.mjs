// actions.mjs — el vocabulario del advisor (spec 008, R6). Responsabilidad ÚNICA: qué acciones
// existen y qué comando lleva cada una. Razón de cambio: el repertorio de acciones.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// `NEXT_ACTION` es un contrato de máquina: el asistente lo COMPARA. Por eso los identificadores
// viven aquí, en un solo sitio, y no pasan por `i18n.mjs` — si cambiaran con `--lang`, el contrato
// se rompería al cambiar el idioma del spec. Lo que sí se traduce es el motivo, que lo lee el humano.
//
// Mismo criterio con el comando: solo lo lleva la acción que de verdad se ejecuta en una terminal.
// Marcar una tarea o llamar al revisor son cosas que hace el asistente, no la shell; anunciarlas
// como comando sería mentir sobre lo que el advisor sabe.

const GATE_DEFAULT = '.chalc/gate.mjs';

// El orden es el de la tabla de prioridad de R9, con la guarda `ask_human` al final: leerlo así
// hace evidente qué gana a qué.
export const ACTIONS = [
  'blocked_config',
  'sync_contract',
  'read_mail',
  'run_gate',
  'fix_gate',
  'call_role',
  'fix_review',
  'tick_task',
  'work_task',
  'done',
  'ask_human'
];

// El comando literal de una acción, o cadena vacía si no se ejecuta en una terminal. `gatePath`
// permite apuntar al portón de OTRO repo en el flujo full-stack, donde el asistente trabaja desde
// un lado y cierra el de al lado.
export function commandOf(action, { gatePath = GATE_DEFAULT, facts = {} } = {}) {
  if (action === 'run_gate') return `node ${gatePath}`;

  // El comando de la deriva MUESTRA la diferencia; nunca sobrescribe (spec 010, R16). Copiar es lo
  // correcto casi siempre, pero lo que se perdería —una nota que el consumidor hubiera añadido a su
  // copia— no deja rastro. Y quien tiene que adaptar código necesita saber QUÉ cambió, no solo
  // quedarse con el archivo nuevo.
  if (action === 'sync_contract' && facts.minePath && facts.ownerPath) {
    return `diff ${facts.minePath} ${facts.ownerPath}`;
  }
  return '';
}
