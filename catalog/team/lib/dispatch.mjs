// dispatch.mjs — despachar un rol sobre una spec (spec 034, R5–R7). Responsabilidad ÚNICA: comprobar que el rol
// corresponde, escribir su orden y decir con qué se lanza. Razón de cambio: qué se exige para despachar.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// chalc NO lanza ningún modelo. Entrega la orden y la forma de lanzarla —el subagente del asistente o la línea
// de comando de otro agente—, y quien despacha la ejecuta. Así el mismo flujo sirve con cualquier asistente.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { option } from './cliargs.mjs';
import { commandProblem, readTeamConfig, resolveCommand, roleConfig } from './config.mjs';
import { appendEvent, readLedger, readStatus } from './ledger.mjs';
import { orderText } from './order.mjs';
import { lessonsFor } from '../../memory/lib/lessons.mjs';
import { git } from './git.mjs';
import { intDir } from './integration.mjs';
import { rolesOf } from './reviewers.mjs';
import { projectRules } from './rules.mjs';
import { normalPath } from './scope.mjs';
import { specScope } from './specstate.mjs';
import { galleryOf } from './uicheck.mjs';

/** Dónde queda la orden de `role` sobre `spec`. */
export const orderPath = (root, spec, role) => join(root, '.chalc', 'team', 'orders', `${spec.split('/').pop()}.${role}.md`);

// Qué es `role` para esta spec: quien desarrolla, quien revisa la entrega, quien revisa lo integrado, u otro.
const kindOf = (role, roles) => (role === 'desarrollador' ? 'developer' : roles.task.includes(role) ? 'reviewer' : roles.feature.includes(role) ? 'closer' : 'other');
// El diseñador tiene dos momentos (spec 040, R5): antes de la aprobación escribe el diseño en el repo; sobre una
// entrega, revisa lo construido como un revisor más.
const designerKind = (role, found) => (role === 'disenador' && found?.state === 'delivered' ? 'reviewer' : '');
// ¿Tiene sentido despachar a ese tipo de rol ahora? El de cierre, solo con TODA la feature integrada (spec 035, R8).
const TIMELY = {
  developer: (found) => found.state === 'in_dev',
  reviewer: (found) => found.state === 'delivered',
  closer: (found, feature) => feature.specs.every((s) => s.state === 'integrated'),
  other: () => true
};

// Con qué corre el rol. El NIVEL del desarrollador es el que quedó registrado al empezar o al relanzarlo: no lo
// cambia nadie a mitad. El lanzador sí sale siempre de la configuración vigente.
function launchOf(config, role, found) {
  const own = roleConfig(config, role);
  return role === 'desarrollador' ? { ...own, tier: found.developer.tier || own.tier } : own;
}

// Por qué no se puede despachar: [problema, dato], o null.
function whyNot(ctx, { spec, role, found, feature, kind, launch }) {
  if (!existsSync(join(ctx.root, '.chalc', 'roles', `${role}.md`))) return ['unknown-role', role];
  if (!found) return ['not-registered', spec];
  if (!TIMELY[kind](found, feature)) return ['wrong-state', role];
  const problem = launch.launcher === 'comando' ? commandProblem(launch.command) : '';
  return problem ? [problem, role] : null;
}

// Dónde trabaja el rol y qué commit mira: el worktree de la spec y su entrega, o el de integración y su punta.
async function placeOf(ctx, { spec, found, feature, kind }) {
  if (kind === 'other') return { dir: ctx.root, head: '' };
  if (kind === 'closer') { const dir = await intDir(ctx.root, feature.feature); return { dir, head: git(dir, ['rev-parse', 'HEAD']).out }; }
  return { dir: found.worktree, head: (await readLedger(ctx.root)).filter((e) => e.type === 'delivered' && e.spec === spec).at(-1)?.head || '' };
}

// Las lecciones vigentes para la spec. La memoria nunca impide despachar: si no se puede leer, no hay lecciones.
async function lessonsOfSpec(dir, spec) {
  try { return await lessonsFor(dir, await readFile(join(dir, ...spec.split('/'), 'spec.md'), 'utf8').catch(() => '')); } catch { return []; }
}

async function orderData(ctx, facts) {
  const { spec, role, found, kind, launch } = facts;
  const { dir, head } = await placeOf(ctx, facts);
  return {
    lang: ctx.lang, role, spec, dir, head, launcher: launch.launcher, tier: launch.tier, skills: launch.skills,
    // Para la orden, quien revisa lo integrado informa igual que quien revisa una entrega: con su entrada en la bitácora.
    kind: kind === 'closer' ? 'reviewer' : kind, gallery: kind === 'other' ? '' : galleryOf(dir),
    attempt: found.attempt, maxAttempts: found.maxAttempts, finding: kind === 'developer' ? found.lastFinding : '',
    rules: projectRules(dir, (await specScope(dir, spec)).touches), lessons: await lessonsOfSpec(dir, spec)
  };
}

/** `team.mjs dispatch --spec <carpeta> --role <rol>`. Devuelve el código de salida. */
export async function dispatchRole(ctx) {
  const spec = normalPath(option(ctx.args, '--spec'));
  const role = option(ctx.args, '--role');
  if (!spec || !role) { ctx.write(ctx.t.dispatchUsage); return 1; }
  const feature = (await readStatus(ctx.root, { now: ctx.now })).features.find((f) => f.specs.some((s) => s.spec === spec));
  const found = feature?.specs.find((s) => s.spec === spec);
  const kind = designerKind(role, found) || kindOf(role, { task: await rolesOf(ctx.root, 'task'), feature: await rolesOf(ctx.root, 'feature') });
  const facts = { spec, role, found, feature, kind, launch: found ? launchOf(await readTeamConfig(ctx.root), role, found) : null };
  const refused = whyNot(ctx, facts);
  if (refused) { ctx.write(ctx.t.problems[refused[0]](refused[1])); return 1; }
  const data = await orderData(ctx, facts);
  const file = orderPath(ctx.root, spec, role);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, orderText(data), 'utf8');
  // La versión de las instrucciones con que sale (spec 037, R1): así se puede ver si cambiarlas cambió algo.
  const instructions = createHash('sha256').update(await readFile(join(ctx.root, '.chalc', 'roles', `${role}.md`))).digest('hex').slice(0, 8);
  await appendEvent(ctx.root, { type: 'dispatched', spec, role, launcher: data.launcher, tier: data.tier, instructions }, { now: ctx.now });
  ctx.write(ctx.t.dispatched({ role, spec, file, launcher: data.launcher, tier: data.tier }));
  if (data.launcher === 'comando') ctx.write(resolveCommand(facts.launch.command, { order: file, dir: data.dir }));
  return 0;
}
