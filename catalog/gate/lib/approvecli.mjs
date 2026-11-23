// approvecli.mjs — `node .chalc/gate.mjs --approve-spec` y `--approve-feature` (spec 024, R14, R15; spec 028,
// R2, R3). Responsabilidad ÚNICA: hablar con la terminal del usuario y traducir el resultado a mensajes y código
// de salida. Razón de cambio: la interacción de una aprobación.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.

import { createInterface } from 'node:readline/promises';
import { approveSpec } from './approve.mjs';
import { approveFeature } from './approvefeature.mjs';
import { loadConfig } from './config.mjs';
import { frameOf, messageOf } from './i18n.mjs';

// Cada aprobación: su opción, quién la decide y bajo qué clave del marco están sus textos.
const KINDS = {
  spec: { option: '--approve-spec', approve: approveSpec, frame: 'approve' },
  feature: { option: '--approve-feature', approve: approveFeature, frame: 'approveFeature' }
};
const commandOf = (kind) => `node .chalc/gate.mjs ${KINDS[kind].option}`;
export const APPROVE_COMMAND = commandOf('spec');

/** La aprobación que pide `argv` (`spec`, `feature`), o '' si no pide ninguna. */
export const approvalIn = (argv) => Object.keys(KINDS).find((kind) => argv.includes(KINDS[kind].option)) || '';

// La terminal real. Sin TTY en la entrada Y en la salida no hay persona delante.
function terminalIo() {
  return {
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: async (prompt) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return await rl.question(prompt); } finally { rl.close(); }
    }
  };
}

// El motivo `no-terminal` → la clave `noTerminal` del marco.
const keyOf = (reason) => reason.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());

function refusal(texts, out, kind) {
  const line = texts[keyOf(out.reason)];
  return typeof line === 'function' ? line(commandOf(kind)) : line;
}

/** Corre la aprobación `kind`. Devuelve el código de salida: 0 sellada, 2 sin terminal, 1 en cualquier otro rechazo. */
export async function approveCommand({ root, write, io = terminalIo(), kind = 'spec' }) {
  const { config } = await loadConfig(root);
  const lang = config.language || 'en';
  const texts = frameOf(lang)[KINDS[kind].frame];
  const out = await KINDS[kind].approve(root, { specDir: config.spec?.dir || 'specs', isTTY: io.isTTY, ask: (name) => io.ask(texts.prompt(name)) });
  if (out.ok) { write(texts.done(out.dir)); return 0; }
  write(refusal(texts, out, kind));
  for (const p of out.problems || []) write(`  ${p.file}:${p.line} — ${messageOf(p.rule, p.data, lang)}`);
  return out.reason === 'no-terminal' ? 2 : 1;
}
