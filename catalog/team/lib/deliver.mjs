// deliver.mjs — entregar una spec (spec 033, R8, R9). Responsabilidad ÚNICA: comprobar que lo que hay en la rama
// de la spec se puede entregar y registrarlo. Razón de cambio: qué se exige a una entrega.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Lo entregado se compara con lo que el plan declaró que la spec toca. Ampliar `Toca:` en el plan para colar un
// archivo no sirve: el plan está sellado, y editarlo deja la spec sin aprobar.

import { option } from './cliargs.mjs';
import { EVIDENCE, hasOpenTasks, passedGate } from './evidence.mjs';
import { git } from './git.mjs';
import { appendEvent, readLedger, readStatus } from './ledger.mjs';
import { inScope, normalPath } from './scope.mjs';
import { specApproved, specScope } from './specstate.mjs';
import { isUi, missingProbes, uiMeasured } from './uicheck.mjs';


// Los archivos que la rama cambió desde la base con la que empezó la spec. Si la feature ya tiene rama de
// integración, desde su punto común con ella (spec 035, R7): lo que la spec trajo de ahí no es cambio suyo.
async function changedSince(ctx, spec) {
  const started = (await readLedger(ctx.root)).filter((e) => e.type === 'started' && e.spec === spec).at(-1);
  const common = ctx.feature ? git(ctx.cwd, ['merge-base', 'HEAD', `refs/heads/chalc/int-${ctx.feature}`]) : { ok: false };
  const from = common.ok ? common.out : started?.base;
  const diff = from ? git(ctx.cwd, ['diff', '--name-only', from, 'HEAD']) : { out: '' };
  return diff.out.split(/\r?\n/).filter(Boolean);
}

// Por qué no se puede entregar: { problem, data, files }; si se puede, { gate } con la corrida que lo respalda.
async function whyNot(ctx, spec, found) {
  if (!found || found.state !== 'in_dev') return { problem: 'not-in-dev', data: spec };
  if (git(ctx.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).out !== found.branch) return { problem: 'wrong-worktree', data: found.branch };
  if (git(ctx.cwd, ['status', '--porcelain']).out) return { problem: 'dirty-tree', data: spec };
  const files = await changedSince(ctx, spec);
  if (!files.length) return { problem: 'nothing-delivered', data: spec };
  if (!await specApproved(ctx.cwd, spec)) return { problem: 'not-approved', data: spec };
  const allowed = [...(await specScope(ctx.cwd, spec)).touches, spec, ...EVIDENCE];
  const outside = files.filter((file) => !inScope(file, allowed));
  if (outside.length) return { problem: 'out-of-scope', data: spec, files: outside };
  // La evidencia (spec 034, R9): todas las tareas hechas y un portón completo que aprobó ESTE código.
  if (await hasOpenTasks(ctx.cwd, spec)) return { problem: 'tasks-open', data: spec };
  const gate = await passedGate(ctx.cwd, spec);
  if (!gate) return { problem: 'gate-not-passed', data: spec };
  // Con interfaz, además, una medición limpia de este código (spec 040, R3).
  if (await isUi(ctx.cwd, spec) && !await uiMeasured(ctx.cwd, spec)) return { problem: 'ui-not-measured', data: spec };
  // Con superficie api o cli, sus sondas sin fallos sobre este código (spec 041, R7).
  return await missingProbes(ctx.cwd, spec) ? { problem: 'surface-not-probed', data: spec } : { gate };
}

/** `team.mjs deliver --spec <carpeta>`, desde el worktree de la spec. Devuelve el código de salida. */
export async function deliverSpec(ctx) {
  const spec = normalPath(option(ctx.args, '--spec'));
  if (!spec) { ctx.write(ctx.t.deliverUsage); return 1; }
  const feature = (await readStatus(ctx.root, { now: ctx.now })).features.find((f) => f.specs.some((s) => s.spec === spec));
  const found = feature?.specs.find((s) => s.spec === spec);
  const refused = await whyNot({ ...ctx, feature: feature?.feature || '' }, spec, found);
  if (refused.problem) {
    ctx.write(ctx.t.problems[refused.problem](refused.data));
    for (const file of refused.files || []) ctx.write(`  - ${file}`);
    return 1;
  }
  const head = git(ctx.cwd, ['rev-parse', 'HEAD']).out;
  // El resultado del portón entra al registro desde su evidencia, no desde lo que diga quien entrega.
  await appendEvent(ctx.root, { type: 'gate', spec, ...refused.gate, stage: '' }, { now: ctx.now });
  await appendEvent(ctx.root, { type: 'delivered', spec, head }, { now: ctx.now });
  ctx.write(ctx.t.delivered(spec, head));
  return 0;
}
