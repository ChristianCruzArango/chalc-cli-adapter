// schedule.mjs — programar las specs de una feature en olas (spec 033, R3, R5). Responsabilidad ÚNICA: comprobar
// que todas se pueden programar y registrar la ola de cada una. Razón de cambio: qué se exige antes de programar.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Todo o nada: una spec sin aprobar, una dependencia que no existe o un ciclo dejan la feature sin programar.

import { option } from './cliargs.mjs';
import { appendEvent, readStatus } from './ledger.mjs';
import { specApproved, specScope } from './specstate.mjs';
import { wavesOf } from './waves.mjs';

// Mientras nadie empezó se puede reprogramar; después, las olas ya son trabajo en curso.
const NOT_STARTED = new Set(['draft', 'approved', 'scheduled']);

// Por qué `specs` no se pueden programar: { problem, spec }, o las olas si se puede.
async function plan(root, specs) {
  const started = specs.find((s) => !NOT_STARTED.has(s.state));
  if (started) return { problem: 'already-started', spec: started.spec };
  for (const { spec } of specs) if (!await specApproved(root, spec)) return { problem: 'not-approved', spec };
  return wavesOf(await Promise.all(specs.map(({ spec }) => specScope(root, spec))));
}

/** `team.mjs waves --feature <nombre>`. Devuelve el código de salida. */
export async function scheduleWaves(ctx) {
  const name = option(ctx.args, '--feature');
  if (!name) { ctx.write(ctx.t.wavesUsage); return 1; }
  const feature = (await readStatus(ctx.root, { now: ctx.now })).features.find((f) => f.feature === name);
  if (!feature) { ctx.write(ctx.t.problems['unknown-feature'](name)); return 1; }
  const out = await plan(ctx.root, feature.specs);
  if (out.problem) { ctx.write(ctx.t.problems[out.problem](out.spec)); return 1; }
  for (const [index, wave] of out.waves.entries()) {
    for (const spec of wave) await appendEvent(ctx.root, { type: 'scheduled', spec, wave: index + 1 }, { now: ctx.now });
    ctx.write(`${ctx.t.wave} ${index + 1}: ${wave.join(', ')}`);
  }
  return 0;
}
