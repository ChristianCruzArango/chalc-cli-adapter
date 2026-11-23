// tdd.mjs — el registro del rojo (spec 030, R1–R4). Responsabilidad ÚNICA: comprobar que los tests de la tarea
// fallan ANTES de que exista su código, y dejarlo escrito con la huella de cada archivo de test. Razón de
// cambio: qué cuenta como un rojo válido.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// «Escribe el test primero» era prosa. Aquí es un hecho con fecha: qué archivos de test había, que fallaban y
// que no había código de producción. Un test se cambia después de la única forma honesta: haciéndolo fallar
// otra vez. Aflojarlo para que pase no se puede sellar.

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { taskScope } from './changed.mjs';
import { loadConfig } from './config.mjs';
import { digestOf } from './integrity.mjs';
import { runCommand } from './run.mjs';
import { isTestFile, isUserSource } from './sources.mjs';
import { activeSpecFile } from './spec.mjs';
import { firstOpenTaskAt } from './specparse.mjs';

export const TDD_REL = '.chalc/tdd.jsonl';
const MIN_SKIP_WORDS = 3;
const at = (root, rel) => join(root, ...rel.split('/'));

/** La clave de una tarea: su spec y su id (`**T3**` → `T3`); sin id, una huella corta de su texto. '' sin tarea. */
export function taskKeyOf(specDir, taskText) {
  const text = String(taskText || '').trim();
  if (!text) return '';
  const id = /\*\*(T[\w.-]*)\*\*/.exec(text)?.[1] || `t-${createHash('sha256').update(text).digest('hex').slice(0, 8)}`;
  return `${specDir}#${id}`;
}

const isRecord = (r) => Boolean(r) && typeof r === 'object' && typeof r.task === 'string' && (r.kind === 'red' || r.kind === 'skip');

/** Los registros de `.chalc/tdd.jsonl`, en orden. Una línea rota se ignora; sin archivo, ninguno. */
export async function readReds(root) {
  let text;
  try { text = await readFile(at(root, TDD_REL), 'utf8'); } catch { return []; }
  return text.split(/\r?\n/).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(isRecord);
}

/** El último registro de la tarea `key`, o null. */
export const lastRed = (reds, key) => reds.filter((r) => r.task === key).at(-1) || null;

/**
 * La tarea en curso de la carpeta activa: { key, tasksFile, text, line }. `key` es '' si no queda ninguna o no
 * hay tasks.md.
 */
export async function currentTask(root, specDir) {
  const tasks = await activeSpecFile(root, specDir, 'tasks.md');
  if (!tasks) return { key: '', tasksFile: '', text: '', line: 0 };
  const open = firstOpenTaskAt(tasks.text);
  return { key: taskKeyOf(tasks.dir, open.text), tasksFile: tasks.path, ...open };
}

async function digests(root, files) {
  const out = {};
  for (const file of files) out[file] = digestOf(await readFile(at(root, file)));
  return out;
}

async function append(root, record) {
  await mkdir(dirname(at(root, TDD_REL)), { recursive: true });
  await appendFile(at(root, TDD_REL), JSON.stringify(record) + '\n', 'utf8');
  return { ok: true, reason: '', record };
}

// La exención: una tarea que de verdad no lleva tests lo dice, con su porqué.
function skipRecord(key, skip, date) {
  const reason = String(skip).trim();
  return reason.split(/\s+/).filter(Boolean).length >= MIN_SKIP_WORDS ? { task: key, kind: 'skip', date, reason } : null;
}

// Lo que impide el rojo ANTES de correr los tests; null si se puede seguir.
function blocker({ command, scope, tests, production, previous }) {
  if (!command) return { reason: 'no-test-command' };
  if (scope.undetermined) return { reason: 'scope-undetermined' };
  if (!tests.length) return { reason: 'no-tests' };
  // Solo en el PRIMER rojo: después, cambiar un test con el código ya escrito es legítimo si vuelve a fallar.
  return previous?.kind === 'red' || !production.length ? null : { reason: 'code-first', files: production };
}

/**
 * Registra el rojo (o la exención `skip`) de la tarea en curso. opts: { run, scope, now, skip }.
 * Devuelve { ok, reason, record, files? }; reason: '' | no-task | skip-reason | no-test-command |
 * scope-undetermined | no-tests | code-first | tests-pass.
 */
export async function registerRed(root, { run = runCommand, scope = taskScope, now = () => new Date(), skip } = {}) {
  const { config } = await loadConfig(root);
  const { key } = await currentTask(root, config.spec?.dir || 'specs');
  const refused = (problem) => ({ ok: false, record: null, ...problem });
  if (!key) return refused({ reason: 'no-task' });
  const date = now().toISOString();
  if (skip !== undefined) {
    const record = skipRecord(key, skip, date);
    return record ? append(root, record) : refused({ reason: 'skip-reason' });
  }
  const changed = await scope(root);
  const files = (changed.files || []).filter(isUserSource);
  const facts = { command: config.test?.command || '', scope: changed, tests: files.filter(isTestFile), production: files.filter((f) => !isTestFile(f)), previous: lastRed(await readReds(root), key) };
  const problem = blocker(facts);
  if (problem) return refused(problem);
  if ((await run(facts.command, { cwd: root })).code === 0) return refused({ reason: 'tests-pass' });
  return append(root, { task: key, kind: 'red', date, tests: await digests(root, facts.tests) });
}
