// close.mjs — cerrar una feature (spec 035, R9, R10). Responsabilidad ÚNICA: comprobar que todo está integrado
// y revisado, pedirle al usuario la fusión y registrar el cierre cuando la hizo. Razón de cambio: qué es cerrar.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// El cierre no lo aprueba nadie con una frase: lo aprueba el usuario FUSIONANDO la rama de integración en la
// suya, desde su terminal. Eso deja un hecho que git puede comprobar, y es lo único que aquí cuenta como cierre.

import { option } from './cliargs.mjs';
import { git } from './git.mjs';
import { intBranch, intDir } from './integration.mjs';
import { appendEvent, readStatus } from './ledger.mjs';
import { rolesOf } from './reviewers.mjs';
import { signedBy } from './verdict.mjs';

// ¿Está ya la rama de integración dentro de la rama del usuario?
const merged = (root, feature) => git(root, ['merge-base', '--is-ancestor', `refs/heads/${intBranch(feature)}`, 'HEAD']).ok;

// Lo que firmaron los roles de cierre sobre el commit integrado: { pending, findings }.
async function closingReview(ctx, feature) {
  const dir = await intDir(ctx.root, feature);
  const roles = await rolesOf(ctx.root, 'feature');
  const signed = await signedBy(dir, roles, git(dir, ['rev-parse', 'HEAD']).out);
  return {
    pending: roles.filter((role) => !signed.get(role)),
    findings: roles.filter((role) => signed.get(role) && !signed.get(role).ok).map((role) => `${role}: ${ctx.t.findingsIn(signed.get(role).findings)}`)
  };
}

async function recordClosed(ctx, feature) {
  if (!feature.closed) {
    await appendEvent(ctx.root, { type: 'human_done', feature: feature.feature }, { now: ctx.now });
    await appendEvent(ctx.root, { type: 'closed', feature: feature.feature }, { now: ctx.now });
  }
  ctx.write(ctx.t.closedFeature(feature.feature));
  return 0;
}

/** `team.mjs close --feature <nombre>`. Devuelve el código de salida. */
export async function closeFeature(ctx) {
  const name = option(ctx.args, '--feature');
  if (!name) { ctx.write(ctx.t.closeUsage); return 1; }
  const status = await readStatus(ctx.root, { now: ctx.now });
  const feature = status.features.find((f) => f.feature === name);
  if (!feature) { ctx.write(ctx.t.problems['unknown-feature'](name)); return 1; }
  const open = feature.specs.find((s) => s.state !== 'integrated');
  if (open || !feature.specs.length) { ctx.write(ctx.t.problems['not-integrated'](open?.spec || name)); return 1; }
  if (merged(ctx.root, name)) return recordClosed(ctx, feature);
  const review = await closingReview(ctx, name);
  if (review.pending.length) { ctx.write(ctx.t.verdictPending(review.pending)); return 1; }
  if (review.findings.length) { review.findings.forEach((line) => ctx.write(line)); return 1; }
  const command = `git merge ${intBranch(name)}`;
  if (!status.waitingHuman.some((wait) => wait.feature === name && wait.command === command)) {
    await appendEvent(ctx.root, { type: 'needs_human', feature: name, reason: ctx.t.mergeAsk(name), command }, { now: ctx.now });
  }
  ctx.write(`${ctx.t.mergeAsk(name)} → ${command}`);
  return 0;
}
