// catalog/gate/lib/data.mjs — utilidades de datos que comparten los runtimes emitidos (portón,
// advisor, memoria). Viven en el árbol del portón porque es la base que los demás ya importan.

import { copyFile, readFile } from 'node:fs/promises';
import { envLanguage } from './config.mjs';
import { frameOf } from './i18n.mjs';

// Un objeto JSON de verdad (no null, no array): lo que un archivo de estado o de config debe ser.
export const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// El texto de un archivo, o '' si no existe o no se puede leer: quien lo usa trata "vacío" y
// "ausente" igual (un registro que aún no se escribió).
export async function textOf(path) {
  try { return await readFile(path, 'utf8'); } catch { return ''; }
}

// Un archivo que el usuario (o lo aprendido) llenó y que ya no es JSON válido no se trata como vacío
// sin más: la siguiente escritura lo reemplazaría. Se copia a `<archivo>.invalid-<marca>` y se avisa
// por stderr, una vez por archivo y proceso — la misma política que `lib/userdata.mjs` en chalc.
// El estado de máquina que se regenera solo (registro del portón, estado de captura) NO pasa por
// aquí: perderlo cuesta volver a calcularlo, no trabajo del usuario.
const kept = new Set();
export async function keepInvalidCopy(path, error) {
  if (kept.has(path)) return;
  kept.add(path);
  const copy = `${path}.invalid-${Date.now()}`;
  try { await copyFile(path, copy); } catch { return; }
  console.error(`  ! ${frameOf(envLanguage()).invalidKept(path, error?.message || error, copy)}`);
}
