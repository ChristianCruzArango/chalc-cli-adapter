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
export async function send({ dir, from, to, message, peers = [], now }) {
  const valid = peers.map((p) => p.id);

  if (!to) return fail('Falta el destinatario.');
  if (to === from) return fail(`No puedes enviarte un aviso a ti mismo (${from}).`);
  if (!valid.includes(to)) return fail(`El lado "${to}" no existe. Los lados de este workspace son: ${valid.join(', ')}.`);

  const text = String(message ?? '').trim();
  if (!text) return fail('El mensaje está vacío.');
  if (/[\r\n]/.test(text)) return fail('El mensaje debe ser UNA línea. Para algo más largo, habla con el usuario.');
  if (text.length > MAX) return fail(`El mensaje tiene ${text.length} caracteres y el máximo es ${MAX}.`);

  const inbox = join(dir, to, 'new');
  await mkdir(inbox, { recursive: true });
  const path = join(inbox, filenameFor(now, from));
  await writeFile(path, `from: ${from}\nto: ${to}\ndate: ${now}\n\n${text}\n`, 'utf8');

  return { ok: true, error: '', path };
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
