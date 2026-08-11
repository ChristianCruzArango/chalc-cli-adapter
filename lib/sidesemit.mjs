// lib/sidesemit.mjs — escribe la sección `flow.sides` en el `.chalc/gate.json` de un lado
// (spec 010, R2). Responsabilidad ÚNICA: persistir esa vista. Razón de cambio: dónde vive la config
// del portón.
//
// Va aparte de `sidesFor`, que la COMPONE y es pura: separar el cálculo de la escritura permite
// probar el layout del workspace sin tocar disco, que es donde están todos los casos raros.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CONFIG_REL = ['.chalc', 'gate.json'];

// Fusiona `sides` dentro del gate.json del lado, conservando todo lo demás. Un archivo ilegible se
// deja como está: reescribirlo desde cero borraría lo que el usuario hubiera ajustado, y una feature
// mal coordinada es mejor que una config perdida.
export async function writeSides(projectPath, sides) {
  const file = join(projectPath, ...CONFIG_REL);

  let config;
  try { config = JSON.parse(await readFile(file, 'utf8')); } catch { return ''; }

  config.flow = { ...config.flow, sides };
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return file;
}
