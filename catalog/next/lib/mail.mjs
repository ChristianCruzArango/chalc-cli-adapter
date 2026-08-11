// mail.mjs — el buzón, en LECTURA (spec 010, R8). Responsabilidad ÚNICA: decir cuántos avisos sin
// leer hay para este lado y de quién. Razón de cambio: el formato del aviso.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Escribir avisos vive en OTRO artefacto (`.chalc/mail.mjs`) y eso no es una separación cosmética: la
// spec 008 hizo del advisor un observador puro, y esa propiedad es la que permite creerle cuando dice
// en qué punto va el ciclo. Un módulo que leyera y escribiera lo convertiría en parte del estado que
// observa.
//
// El asimetría del canal es deliberada: enviar es opcional —nadie puede obligar a nadie a escribir un
// aviso— pero leer no lo es. Si alguien se molesta en dejar uno, el otro lado lo va a ver.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// `from: <lado>` en la cabecera. Un archivo sin remitente legible no es un aviso: se ignora en vez de
// contarse, porque un contador que sube por un archivo suelto en la carpeta se aprende a ignorar.
const FROM = /^from:[ \t]*([a-z][a-z0-9-]*)[ \t]*$/m;

const VACIO = { unread: 0, from: [] };

// Los avisos sin leer de `dir/<me>/new`. Cualquier fallo de lectura —carpeta ausente, permisos, un
// lado que ya no está— devuelve "sin avisos": es un canal secundario y no puede tumbar el ciclo (R12).
export async function unreadMail(dir, me) {
  if (!dir || !me) return { ...VACIO };

  const inbox = join(dir, me, 'new');
  let names;
  try { names = await readdir(inbox); } catch { return { ...VACIO }; }

  const senders = new Set();
  let unread = 0;
  for (const name of names) {
    let text;
    try { text = await readFile(join(inbox, name), 'utf8'); } catch { continue; }
    const match = FROM.exec(text);
    if (!match) continue;
    senders.add(match[1]);
    unread += 1;
  }
  return { unread, from: [...senders].sort() };
}
