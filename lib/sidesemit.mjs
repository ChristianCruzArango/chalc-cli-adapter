// lib/sidesemit.mjs — escribe la sección `flow.sides` en el `.chalc/gate.json` de un lado
// (spec 010, R2). Responsabilidad ÚNICA: persistir esa vista. Razón de cambio: dónde vive la config
// del portón.
//
// Va aparte de `sidesFor`, que la COMPONE y es pura: separar el cálculo de la escritura permite
// probar el layout del workspace sin tocar disco, que es donde están todos los casos raros.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_REL } from '../catalog/gate/lib/config.mjs';
import { readJsonOrKeep } from './userdata.mjs';

// Fusiona `sides` dentro del gate.json del lado, conservando todo lo demás. Un archivo ilegible se
// deja como está: reescribirlo desde cero borraría lo que el usuario hubiera ajustado, y una feature
// mal coordinada es mejor que una config perdida.
export async function writeSides(projectPath, sides) {
  const file = join(projectPath, CONFIG_REL);

  // Ilegible: se respalda y se avisa (lib/userdata.mjs), y no se escribe encima.
  const config = await readJsonOrKeep(file, null);
  if (!config) return '';

  config.flow = { ...config.flow, sides };
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return file;
}
