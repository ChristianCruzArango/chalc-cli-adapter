// mailbox.mjs — el buzón, en ESCRITURA (spec 010, R6, R7, R10). Responsabilidad ÚNICA: dejar un
// aviso en la bandeja del destinatario y mover los leídos. Razón de cambio: el formato del aviso.
//
// Este archivo lo emite chalc dentro de `.chalc/mail/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Vive SEPARADO del advisor y eso no es cosmético: la spec 008 hizo del advisor un observador puro,
// y esa propiedad es la que permite creerle cuando dice en qué punto va el ciclo. Un artefacto que
// leyera el estado y lo modificara dejaría de poder responder honestamente.
//
// No hay entrega que esperar: los lados comparten el sistema de archivos, así que quien escribe deja
// el aviso directamente donde el otro lo lee. Sin demonio, sin cola de salida, sin reintentos.

import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { textOf } from './text.mjs';

// Un aviso es UNA línea. Lo que necesita más es una conversación con el usuario, no un archivo entre
// dos terminales — y un buzón con párrafos deja de leerse en dos días.
const MAX = 200;

const fail = (error) => ({ ok: false, error, path: '' });

// Nombre ordenable por fecha, con el remitente a la vista para poder auditar la carpeta de un
// vistazo. Los dos puntos de la hora no valen en Windows.
const filenameFor = (now, from) => `${String(now).replace(/[:-]/g, '')}-from-${from}.md`;

// Deja un aviso para `to`. Devuelve { ok, error, path }.
//
// La validación es estricta y ocurre ANTES de crear nada (R7): un aviso a medias es peor que ninguno
// —el otro lado lo lee, no entiende qué se le pide y deja de mirar el buzón— y una carpeta creada
// para un destinatario inventado quedaría ahí para siempre.
export async function send({ dir, from, to, message, peers = [], now, lang = 'en' }) {
  const valid = peers.map((p) => p.id);
  const tx = textOf(lang);

  if (!to) return fail(tx.noRecipient);
  if (to === from) return fail(tx.toSelf(from));
  if (!valid.includes(to)) return fail(tx.unknownSide(to, valid.join(', ')));

  const text = String(message ?? '').trim();
  if (!text) return fail(tx.emptyMessage);
  if (/[\r\n]/.test(text)) return fail(tx.oneLine);
  if (text.length > MAX) return fail(tx.tooLong(text.length, MAX));

  const inbox = join(dir, to, 'new');
  await mkdir(inbox, { recursive: true });
  // `wx`: nunca se pisa un aviso. Dos en el mismo segundo del mismo lado tenían el mismo nombre y el
  // segundo borraba al primero; ahora el segundo lleva `-2` (y así), que ordena detrás.
  const body = `from: ${from}\nto: ${to}\ndate: ${now}\n\n${text}\n`;
  const base = filenameFor(now, from).replace(/\.md$/, '');
  for (let n = 1; n <= 100; n++) {
    const path = join(inbox, `${base}${n === 1 ? '' : `-${n}`}.md`);
    try {
      await writeFile(path, body, { encoding: 'utf8', flag: 'wx' });
      return { ok: true, error: '', path };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  return fail(tx.tooMany);
}

// Mueve a `read/` los avisos sin leer de `me`. Devuelve cuántos.
//
// Se conservan en vez de borrarse (R10): son el registro de lo que se coordinó, y el coste de
// guardarlos es cero comparado con el de no poder reconstruir por qué se hizo algo.
export async function markRead(dir, me) {
  const inbox = join(dir, me, 'new');
  const done = join(dir, me, 'read');

  let names;
  try { names = await readdir(inbox); } catch { return 0; }
  if (!names.length) return 0;

  await mkdir(done, { recursive: true });
  let moved = 0;
  for (const name of names) {
    try { await rename(join(inbox, name), join(done, name)); moved += 1; } catch { /* ya no está: no es un fallo */ }
  }
  return moved;
}
