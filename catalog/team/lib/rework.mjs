// rework.mjs — qué pasa con una entrega rechazada (spec 034, R11). Responsabilidad ÚNICA: decidir entre rehacer,
// relanzar con un modelo superior o escalar. Razón de cambio: la política de rechazos.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: ajusta `.chalc/team.json`.
//
// Un rechazo vuelve al MISMO desarrollador: ya conoce la spec y trae el hallazgo en su orden. Pero no para
// siempre: agotado el tope, se prueba UNA vez con el nivel de modelo siguiente, y si tampoco, decide el usuario.
// Seguir reintentando sin límite gasta sin acercarse a nada.

import { option } from './cliargs.mjs';
import { nextTier } from './config.mjs';
import { appendEvent, readStatus } from './ledger.mjs';
import { normalPath } from './scope.mjs';

// El evento con el que sigue una spec rechazada.
function nextStep(found) {
  if (found.attempt < found.maxAttempts) return { type: 'rework' };
  const tier = found.relaunched ? '' : nextTier(found.developer.tier);
  return tier ? { type: 'relaunched', tier } : { type: 'escalated', reason: found.lastFinding };
}

/** `team.mjs rework --spec <carpeta>`. Devuelve el código de salida. */
export async function reworkSpec(ctx) {
  const spec = normalPath(option(ctx.args, '--spec'));
  if (!spec) { ctx.write(ctx.t.reworkUsage); return 1; }
  const feature = (await readStatus(ctx.root, { now: ctx.now })).features.find((f) => f.specs.some((s) => s.spec === spec));
  const found = feature?.specs.find((s) => s.spec === spec);
  if (!found || found.state !== 'rejected') { ctx.write(ctx.t.problems['not-rejected'](spec)); return 1; }
  const step = nextStep(found);
  await appendEvent(ctx.root, { ...step, spec }, { now: ctx.now });
  if (step.type === 'rework') ctx.write(ctx.t.reworked(spec, found.attempt + 1, found.maxAttempts));
  if (step.type === 'relaunched') ctx.write(ctx.t.relaunched(spec, step.tier));
  if (step.type === 'escalated') {
    // Solo el orquestador habla con el usuario: aquí queda anotado qué tiene que mirar.
    await appendEvent(ctx.root, { type: 'needs_human', feature: feature.feature, reason: ctx.t.escalated(spec), command: 'node .chalc/team.mjs status' }, { now: ctx.now });
    ctx.write(ctx.t.escalated(spec));
  }
  return 0;
}
