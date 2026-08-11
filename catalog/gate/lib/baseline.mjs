// baseline.mjs — la línea base de la tarea (spec 013, R1/R3). Responsabilidad ÚNICA: leer y sellar
// `.chalc/task.json`. Razón de cambio: el esquema de la línea base.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Por qué existe: hasta ahora "los archivos de esta tarea" no era un dato de nadie. El portón medía
// contra la base de la RAMA —o sea, contra todas las tareas anteriores juntas— y el prompt del
// revisor pedía "solo lo que esta tarea tocó" sin que nadie pudiera dárselo. Ese hueco lo rellenaba
// el modelo a ojo, y lo rellenaba mal en las dos direcciones: revisando deuda vieja, o no revisando
// nada porque "el diff traía trabajo ajeno". Aquí ese punto de partida pasa a estar escrito.
//
// Vive en `.chalc/`, que ya es por worktree y por lado: R5 sale por construcción, sin código propio.
//
// Todo lo que se lee falla hacia "no hay línea base", nunca hacia una excepción. El respaldo de R4
// está declarado y es seguro; una corrida caída no lo es.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const TASK_REL = '.chalc/task.json';

const NONE = { exists: false, commit: '', date: 0, sealedBy: '' };

// Un commit de git, no una revisión cualquiera. `HEAD~1` o una rama servirían para `git diff`, pero
// se mueven solos: la línea base tiene que apuntar SIEMPRE al mismo sitio, o dejaría de ser una base.
const COMMIT = /^[0-9a-f]{4,40}$/;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Los hechos de la línea base a partir del texto de `.chalc/task.json`. Ausente, corrupto, sin
// commit usable o sin fecha usable → no hay línea base.
export function parseBaseline(text) {
  let raw;
  try { raw = JSON.parse(String(text ?? '')); } catch { return { ...NONE }; }
  if (!isPlainObject(raw) || !isPlainObject(raw.base)) return { ...NONE };

  const commit = String(raw.base.commit ?? '').trim().toLowerCase();
  if (!COMMIT.test(commit)) return { ...NONE };

  const date = Date.parse(raw.base.date);
  if (!Number.isFinite(date)) return { ...NONE };

  return { exists: true, commit, date, sealedBy: String(raw.sealedBy ?? '') };
}

// La línea base de `root`.
export async function readBaseline(root) {
  try { return parseBaseline(await readFile(join(root, TASK_REL), 'utf8')); } catch { return { ...NONE }; }
}

// Sella la línea base de la SIGUIENTE tarea y devuelve la que queda vigente.
//
// Idempotente en el mismo commit (R3): dos corridas seguidas del portón sin trabajo en medio no
// mueven la referencia ni refrescan la fecha. Refrescarla daría por reciente una base que no lo es,
// y la frescura del advisor se mide contra ella.
//
// Sin un commit usable no se sella nada: escribir una base que `git diff` va a rechazar dejaría el
// alcance vacío, y R13 prohíbe que un alcance vacío pase por bueno.
export async function sealBaseline(root, { commit, date = new Date(), sealedBy = 'gate' } = {}) {
  const ref = String(commit ?? '').trim().toLowerCase();
  if (!COMMIT.test(ref)) return { ...NONE };

  const current = await readBaseline(root);
  if (current.exists && current.commit === ref) return current;

  const sealed = { base: { commit: ref, date: new Date(date).toISOString() }, sealedBy };
  const path = join(root, TASK_REL);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(sealed, null, 2) + '\n', 'utf8');

  return parseBaseline(JSON.stringify(sealed));
}
