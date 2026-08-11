// snapshot.mjs — los hechos del repo (spec 008, R8, R11). Responsabilidad ÚNICA: leer el estado del
// repo y entregarlo como datos. Razón de cambio: de dónde salen los hechos.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Es el ÚNICO módulo del advisor con efectos, y eso es deliberado: al concentrar aquí el I/O,
// `decide.mjs` queda puro y su tabla de prioridad se puede probar rama por rama sin fixtures. La
// contrapartida es que todo el riesgo vive en este archivo, con una obligación que el resto no
// tiene: no romperse. Un advisor que revienta deja al asistente sin siguiente paso, que es peor que
// no tener advisor. Por eso cada lectura falla hacia un `problem`, nunca hacia una excepción (R11).
//
// Prohibición (R8): SOLO LECTURA. Ni crear, ni modificar, ni borrar — el advisor observa el estado,
// no participa en él.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { currentBranch, taskScope } from '../../gate/lib/changed.mjs';
import { loadConfig } from '../../gate/lib/config.mjs';
import { newestSpec } from '../../gate/lib/spec.mjs';
import { allReviews, lastReview } from './review.mjs';
import { contractDrift } from './contract.mjs';
import { unreadMail } from './mail.mjs';
import { parseGateState } from './state.mjs';
import { tasksProgress, currentTask } from './tasks.mjs';

const STATE_REL = '.chalc/gate.state.json';
const REVIEW_REL = '.chalc/review.md';

// Puertas por defecto, iguales a las que el portón escribe en `gate.json`. Se repiten aquí porque un
// repo equipado con una versión anterior de chalc no las tendrá, y el defecto seguro es el
// comportamiento de siempre: revisor obligatorio y OK del usuario al cerrar cada tarea.
const FLOW_DEFAULT = { approvals: { task: true, feature: true }, review: { required: true } };

// Roles cuando `gate.json` no los declara — un repo equipado antes de la spec 009. Tratarlo como
// "sin roles" desactivaría la revisión EN SILENCIO al actualizar chalc, que es lo peor que podría
// pasar. Se cae al único rol que existía entonces, respetando su knob de entonces.
const rolesOr = (declared, review) => (Array.isArray(declared) && declared.length
  ? declared
  : [{ id: 'revisor', order: 10, cadence: 'task', required: review.required !== false }]);

const textOf = async (path) => { try { return await readFile(path, 'utf8'); } catch { return ''; } };

const mtimeOf = async (path) => { try { return (await stat(path)).mtimeMs; } catch { return 0; } };

// Lo pedido, o el problema que impidió leerlo. Ninguna lectura puede tumbar al advisor.
async function attempt(problems, label, read, fallback) {
  try { return await read(); } catch (err) { problems.push(`${label}: ${err.message}`); return fallback; }
}

// El tasks.md de la spec vigente, con su fecha — que es lo que distingue un verde sin reclamar de
// uno ya reclamado (R9).
async function readTasks(root, specDir, findSpec) {
  const found = await findSpec(root, specDir, 'tasks.md');
  if (!found) return { hasTasksFile: false, done: 0, total: 0, current: '', mtime: 0 };

  const { done, total } = tasksProgress(found.text);
  return { hasTasksFile: true, done, total, current: currentTask(found.text), mtime: await mtimeOf(join(root, found.path)) };
}

// El alcance de la tarea (spec 013, R8), tolerante a todo.
//
// El advisor mide la frescura sobre esta lista, así que quién esté en ella decide si manda a correr
// el portón. Medirla sobre archivos que no son de esta tarea invalidaría la evidencia buena de hoy
// por algo que nadie tocó, una y otra vez — ese archivo ajeno no se va a arreglar solo.
//
// Y "no sé qué cambió" entra como PROBLEMA, no como lista vacía. Son dos conclusiones opuestas: la
// lista vacía dice que no hay trabajo pendiente y puede acabar cerrando la feature; el "no sé" es
// justo el caso en el que hay que parar y preguntar (spec 008, R11).
async function readScope(problems, read) {
  let scope;
  try {
    scope = await read();
  } catch (err) {
    problems.push(`.chalc/gate/lib/changed.mjs: ${err.message}`);
    return { files: [], source: 'none', undetermined: false };
  }

  // Un lector inyectado puede devolver solo la lista: el alcance de siempre, ya determinado.
  const resolved = Array.isArray(scope)
    ? { files: scope, source: 'given', undetermined: false }
    : { files: [], source: 'none', undetermined: false, ...(scope || {}) };

  if (resolved.undetermined) problems.push('scope-undetermined');
  return resolved;
}

// La fecha del fuente cambiado más reciente. Sin cambios es 0, no "ahora": inventar un instante
// invalidaría cualquier evidencia y mandaría a correr el portón para siempre.
async function newestOf(root, files) {
  let newest = 0;
  for (const file of files) newest = Math.max(newest, await mtimeOf(join(root, file)));
  return newest;
}

// La deriva entre la copia del contrato de este lado y la del dueño (spec 010, R1).
//
// Es la única lectura que sale del repo, y va acotada al workspace. Todo lo que pueda fallar —un lado
// movido, un contrato que no existe, permisos— cae a "sin deriva": mandar a sincronizar contra un
// archivo que no está sería peor que callar, y R12 prohíbe que un canal secundario bloquee el ciclo.
async function readContract(root, sides, specDir, findSpec) {
  const nothing = { differs: false, lines: 0, ownerId: '', minePath: '', ownerPath: '' };
  if (!sides?.enabled || !sides.owner || sides.me === sides.owner) return nothing;

  const owner = (sides.peers || []).find((p) => p.id === sides.owner);
  if (!owner) return nothing;

  const mine = await findSpec(root, specDir, join('contracts', 'api.md'));
  if (!mine) return nothing;

  const ownerPath = join(owner.path, mine.path);
  const theirs = await textOf(join(root, ownerPath));

  return {
    ...contractDrift(mine.text, theirs),
    ownerId: sides.owner,
    minePath: mine.path.replace(/\\/g, '/'),
    ownerPath: ownerPath.replace(/\\/g, '/')
  };
}

// Los hechos del repo en `root`. Las lecturas del portón se inyectan para poder probar el manejo de
// fallos sin romper la instalación. Devuelve el snapshot que consume `decide`.
export async function snapshot(root, {
  changed = taskScope, branch = currentBranch, config = loadConfig, findSpec = newestSpec
} = {}) {
  const problems = [];

  const loaded = await attempt(problems, '.chalc/gate.json', () => config(root), null);
  const gateConfig = loaded?.config || {};

  const scope = await readScope(problems, () => changed(root));
  const files = scope.files;
  const currentRef = await attempt(problems, 'git', () => branch(root), '');

  const tasks = await attempt(
    problems, 'tasks.md',
    () => readTasks(root, gateConfig.spec?.dir || 'specs', findSpec),
    { hasTasksFile: false, done: 0, total: 0, current: '', mtime: 0 }
  );

  const gate = parseGateState(await textOf(join(root, STATE_REL)));
  const reviewText = await textOf(join(root, REVIEW_REL));
  const review = { ...FLOW_DEFAULT.review, ...(gateConfig.flow?.review || {}) };
  const sides = gateConfig.flow?.sides;

  return {
    tasks,
    gate: { ...gate, pending: Array.isArray(gateConfig.pending) ? gateConfig.pending : [] },
    review: { ...lastReview(reviewText), entries: allReviews(reviewText) },
    changed: { files, newestMtime: await newestOf(root, files), source: scope.source, undetermined: scope.undetermined },
    flow: {
      approvals: { ...FLOW_DEFAULT.approvals, ...(gateConfig.flow?.approvals || {}) },
      review,
      roles: rolesOr(gateConfig.flow?.roles, review),
      sides
    },
    contract: await attempt(problems, 'contrato del lado dueño',
      () => readContract(root, sides, gateConfig.spec?.dir || 'specs', findSpec),
      { differs: false, lines: 0, ownerId: '', minePath: '', ownerPath: '' }),
    mail: await attempt(problems, 'buzón',
      () => (sides?.enabled && sides.mail ? unreadMail(join(root, sides.mail), sides.me) : { unread: 0, from: [] }),
      { unread: 0, from: [] }),
    git: { isRepo: !!currentRef, branch: currentRef },
    // El idioma del SPEC, no el del CLI: el advisor vive dentro del repo del usuario y habla como
    // se escribió su spec. Solo afecta al motivo — la acción y el comando nunca se traducen.
    lang: gateConfig.language || 'en',
    problems
  };
}
