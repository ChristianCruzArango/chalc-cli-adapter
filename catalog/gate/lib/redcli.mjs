// redcli.mjs — `node .chalc/gate.mjs --red` (spec 030, R1–R4). Responsabilidad ÚNICA: traducir el resultado del
// registro del rojo a mensajes y código de salida. Razón de cambio: cómo se informa de un rojo.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.

import { loadConfig } from './config.mjs';
import { frameOf } from './i18n.mjs';
import { registerRed } from './tdd.mjs';

// El motivo `code-first` → la clave `codeFirst` del marco.
const keyOf = (reason) => reason.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());

/** Registra el rojo de la tarea en curso (`--skip "<motivo>"` para la exención). Devuelve 0 si quedó registrado. */
export async function redCommand({ root, argv, write, ...world }) {
  const texts = frameOf((await loadConfig(root)).config.language || 'en').red;
  const skip = argv.includes('--skip') ? argv[argv.indexOf('--skip') + 1] || '' : undefined;
  const out = await registerRed(root, { ...world, skip });
  if (!out.ok) {
    const line = texts[keyOf(out.reason)];
    write(typeof line === 'function' ? line(out.files || []) : line);
    return 1;
  }
  write(out.record.kind === 'skip' ? texts.skipped(out.record.task, out.record.reason) : texts.done(out.record.task, Object.keys(out.record.tests).length));
  return 0;
}
