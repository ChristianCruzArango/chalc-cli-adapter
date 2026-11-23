// verdict.mjs — el veredicto de una entrega (spec 034, R10). Responsabilidad ÚNICA: leer la bitácora de revisión
// del worktree y registrar lo que cada rol firmó sobre el commit entregado. Razón de cambio: qué cuenta como revisado.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// La palabra de un rol no cuenta: cuenta su entrada en `.chalc/review.md`, con su nombre y el commit que miró.
// Un rol con hallazgos rechaza la entrega en el acto; para darla por revisada hacen falta TODOS, y todos en OK.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { capture } from '../../memory/lib/capture.mjs';
import { allReviews } from '../../next/lib/review.mjs';
import { option } from './cliargs.mjs';
import { appendEvent, readLedger, readStatus } from './ledger.mjs';
import { reviewRoles } from './reviewers.mjs';
import { normalPath } from './scope.mjs';
import { isUi } from './uicheck.mjs';

const REVIEWABLE = new Set(['delivered', 'rejected', 'reviewed_ok']);
// Menos de siete caracteres no identifican un commit: una entrada así no dice qué miró.
const about = (entry, head) => entry.commit.length >= 7 && head.startsWith(entry.commit);

/** La última entrada de cada rol sobre `head`, en la bitácora de `worktree`: Map rol → entrada | null. */
export async function signedBy(worktree, roles, head) {
  let text = '';
  try { text = await readFile(join(worktree, '.chalc', 'review.md'), 'utf8'); } catch { /* sin bitácora: nadie firmó */ }
  const entries = allReviews(text).filter((entry) => about(entry, head));
  return new Map(roles.map((role) => [role, entries.filter((entry) => entry.role === role).at(-1) || null]));
}

// Lo que ya se registró de ESTA entrega, y su commit.
function delivery(events, spec) {
  const own = events.filter((event) => event.spec === spec);
  const index = own.map((event) => event.type).lastIndexOf('delivered');
  return { head: index < 0 ? '' : own[index].head, recorded: new Set(own.slice(index + 1).filter((e) => e.type === 'reviewed').map((e) => e.role)) };
}

// Lo que quien revisó dejó como regla aprendida entra a la memoria de todos EN ESTE MOMENTO (spec 036, R3), no
// cuando se cierre la tarea. Un problema con la memoria nunca cambia un veredicto.
async function learn(worktree) {
  try { await capture(worktree); } catch { /* la memoria es una ayuda, no una puerta */ }
}

const summaryOf = (entry, t) => (entry.ok ? 'OK' : t.findingsIn(entry.findings));

/** `team.mjs verdict --spec <carpeta>`. Devuelve 0 solo si todos los roles exigidos firmaron OK. */
export async function verdictOf(ctx) {
  const spec = normalPath(option(ctx.args, '--spec'));
  if (!spec) { ctx.write(ctx.t.verdictUsage); return 1; }
  const found = (await readStatus(ctx.root, { now: ctx.now })).features.flatMap((f) => f.specs).find((s) => s.spec === spec);
  if (!found || !REVIEWABLE.has(found.state)) { ctx.write(ctx.t.problems['not-delivered'](spec)); return 1; }
  // Con interfaz, el diseñador también firma la entrega (spec 040, R4).
  const roles = [...await reviewRoles(ctx.root), ...(await isUi(found.worktree, spec) ? ['disenador'] : [])];
  if (!roles.length) { ctx.write(ctx.t.problems['no-reviewers'](spec)); return 1; }
  const { head, recorded } = delivery(await readLedger(ctx.root), spec);
  const signed = await signedBy(found.worktree, roles, head);
  const pending = roles.filter((role) => !signed.get(role));
  const rejected = roles.some((role) => signed.get(role) && !signed.get(role).ok);
  // Un rechazo se registra ya; los OK, solo cuando están todos: un OK suelto no da nada por revisado.
  const toRecord = roles.filter((role) => signed.get(role) && !recorded.has(role) && (rejected ? !signed.get(role).ok : !pending.length));
  for (const role of toRecord) {
    const entry = signed.get(role);
    await appendEvent(ctx.root, { type: 'reviewed', spec, role, ok: entry.ok, findings: entry.findings, summary: summaryOf(entry, ctx.t) }, { now: ctx.now });
  }
  if (toRecord.length) await learn(found.worktree);
  for (const role of roles) ctx.write(`${role}: ${signed.get(role) ? summaryOf(signed.get(role), ctx.t) : ctx.t.noEntry}`);
  if (pending.length) ctx.write(ctx.t.verdictPending(pending));
  return pending.length || rejected ? 1 : 0;
}
