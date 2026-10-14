// lib/skillsource/within.mjs — ¿una ruta está dentro de otra? Responsabilidad ÚNICA: la comparación
// por segmentos (no con `startsWith`: `/tmp/a` no contiene a `/tmp/ab`).

import { relative, isAbsolute } from 'node:path';

export const within = (base, target) => {
  const rel = relative(base, target);
  // La misma ruta da rel '': su primer segmento no es '..' y no es absoluta, así que cuenta como dentro.
  return rel.split(/[\\/]/)[0] !== '..' && !isAbsolute(rel);
};
