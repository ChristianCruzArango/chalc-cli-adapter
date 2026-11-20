// test/helpers/tmpdir.mjs — carpetas temporales que se borran solas al terminar el test (spec 022, 5.3).
// Responsabilidad ÚNICA: crear el temporal y registrar su limpieza en `t.after`, para no dejar cientos de
// directorios en el sistema por cada corrida de la suite.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// En Windows, un proceso hijo que acaba de salir puede retener su carpeta (cwd) un instante: el borrado da
// EBUSY y el hook `after` hace fallar el test. `rm` reintenta solo ante EBUSY/EPERM/ENOTEMPTY/EMFILE.
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };

/** Crea un temporal con `prefix` y lo borra (recursivo, forzado, con reintentos) cuando termina el test `t`. */
export async function tempDir(t, prefix = 'chalc-test-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, RM_OPTIONS));
  return dir;
}

/** Corre `fn(dir)` con un temporal que se borra al terminar el test `t`; devuelve lo que devuelva `fn`. */
export async function withTempDir(t, fn, prefix) {
  return fn(await tempDir(t, prefix));
}
