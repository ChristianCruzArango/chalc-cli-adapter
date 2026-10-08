// mail.mjs — el buzón entre lados (spec 010). Responsabilidad ÚNICA: enviar un aviso y marcar los
// recibidos como leídos. Razón de cambio: la interfaz del buzón.
//
// Este archivo lo emite chalc dentro de `.chalc/mail/`. Se ejecuta con `node .chalc/mail.mjs` y se
// REGENERA al equipar el repo: no lo edites, ajusta `.chalc/gate.json`.
//
// Para qué existe: el contrato compartido se sincroniza solo —el advisor detecta que tu copia quedó
// vieja comparándola con la del dueño— pero hay cosas que ningún archivo puede decir. "Estoy
// bloqueado esperando el endpoint de pagos" no está en disco, y sin este canal el usuario tiene que
// hacer de mensajero entre dos terminales.
//
// Va SEPARADO del advisor a propósito: aquél observa y no escribe (spec 008, R8), y esa propiedad es
// la que lo hace fiable. Aquí se escribe, así que es otro artefacto.

import { join } from 'node:path';
import { markRead, send } from './lib/mailbox.mjs';
import { loadConfig } from '../gate/lib/config.mjs';
import { textOf } from './lib/text.mjs';

// La vista del workspace que tiene este lado (sin ella no hay buzón: es un mono-repo) y el idioma
// del proyecto, del mismo gate.json.
async function settingsOf(root) {
  const { config } = await loadConfig(root);
  return { sides: config.flow?.sides || null, lang: config.language };
}

// `--to front` / `--message "..."`, sin dependencias de parseo.
function argOf(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] || '' : '';
}

export async function run(argv, root = process.cwd(), now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')) {
  const { sides, lang } = await settingsOf(root);
  const tx = textOf(lang);
  if (!sides?.enabled || !sides.mail) return { code: 1, out: tx.noMailbox };

  const dir = join(root, sides.mail);
  const [command] = argv;

  if (command === 'read') {
    const moved = await markRead(dir, sides.me);
    return { code: 0, out: moved ? tx.markedRead(moved) : tx.nothingUnread };
  }

  if (command === 'send') {
    const result = await send({
      dir, from: sides.me, to: argOf(argv, 'to'), message: argOf(argv, 'message'), peers: sides.peers || [], now, lang
    });
    return result.ok ? { code: 0, out: tx.sent(argOf(argv, 'to')) } : { code: 1, out: result.error };
  }

  return { code: 1, out: tx.usage };
}

// Entrada de línea de comandos. Solo corre cuando se invoca el archivo, no al importarlo.
if (process.argv[1] && /mail\.mjs$/.test(process.argv[1])) {
  const result = await run(process.argv.slice(2), process.cwd());
  console.log(result.out);
  process.exit(result.code);
}
