// integrate.mjs — integrar las specs revisadas de una feature (spec 035, R1–R6). Responsabilidad ÚNICA: unirlas
// de una en una, medir cada unión y registrar el resultado. Razón de cambio: qué se exige para integrar.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Que cada rama pase sola no dice que pasen juntas. Por eso se unen de UNA en una y se corren las pruebas tras
// cada unión: si fallan, la culpable es la que acaba de entrar. Se deshace, se nombra y se para.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { option } from './cliargs.mjs';
import { readTeamConfig } from './config.mjs';
import { git } from './git.mjs';
import { ensureIntegration, intBranch, mergeSpec } from './integration.mjs';
import { appendEvent, readLedger, readStatus } from './ledger.mjs';
import { runsOk } from './runtests.mjs';

// El comando de pruebas del proyecto: el mismo que usa el portón.
async function testCommand(root) {
  try { return JSON.parse(await readFile(join(root, '.chalc', 'gate.json'), 'utf8')).test?.command || ''; } catch { return ''; }
}

// Las specs listas para unir, por ola y, dentro de la ola, en su orden.
const ready = (feature) => feature.specs.filter((s) => s.state === 'reviewed_ok').sort((a, b) => (a.wave ?? Infinity) - (b.wave ?? Infinity));

// Une UNA spec y mide la unión. Devuelve '' si quedó integrada, o por qué no.
async function integrateOne(ctx, feature, spec, run) {
  const merged = mergeSpec(run.dir, spec.branch);
  if (!merged.ok) {
    const reason = ctx.t.conflictIn(merged.conflicts);
    await appendEvent(ctx.root, { type: 'blocked', spec: spec.spec, reason, by: 'integracion' }, { now: ctx.now });
    await appendEvent(ctx.root, { type: 'needs_human', feature, reason: `${spec.spec}: ${reason}`, command: 'node .chalc/team.mjs status' }, { now: ctx.now });
    return `${spec.spec}: ${reason}`;
  }
  const undo = () => git(run.dir, ['reset', '-q', '--hard', merged.before]);
  if (!runsOk(run.setup, run.dir)) { undo(); return ctx.t.problems['setup-failed'](spec.spec); }
  if (!runsOk(run.tests, run.dir)) {
    undo();
    await appendEvent(ctx.root, { type: 'reviewed', spec: spec.spec, role: 'integracion', ok: false, findings: 1, summary: ctx.t.breaksSummary(intBranch(feature)) }, { now: ctx.now });
    return ctx.t.breaksTogether(spec.spec);
  }
  await appendEvent(ctx.root, { type: 'integrated', spec: spec.spec, head: git(run.dir, ['rev-parse', 'HEAD']).out }, { now: ctx.now });
  return '';
}

// Por qué no se puede integrar nada: [problema, dato], o null.
function whyNot(name, feature, tests) {
  if (!feature) return ['unknown-feature', name];
  if (!tests.trim()) return ['no-test-command'];
  return ready(feature).length ? null : ['nothing-to-integrate', name];
}

/** `team.mjs integrate --feature <nombre>`. Devuelve 0 solo si todo lo revisado quedó integrado. */
export async function integrateFeature(ctx) {
  const name = option(ctx.args, '--feature');
  if (!name) { ctx.write(ctx.t.integrateUsage); return 1; }
  const feature = (await readStatus(ctx.root, { now: ctx.now })).features.find((f) => f.feature === name);
  const tests = await testCommand(ctx.root);
  const refused = whyNot(name, feature, tests);
  if (refused) { ctx.write(ctx.t.problems[refused[0]](refused[1])); return 1; }
  const own = new Set(feature.specs.map((s) => s.spec));
  const base = (await readLedger(ctx.root)).find((e) => e.type === 'started' && own.has(e.spec))?.base || 'HEAD';
  const place = await ensureIntegration(ctx.root, name, base);
  if (!place.ok) { ctx.write(ctx.t.problems['worktree-failed'](place.err)); return 1; }
  const run = { dir: place.dir, tests, setup: (await readTeamConfig(ctx.root)).setup || '' };
  for (const spec of ready(feature)) {
    const problem = await integrateOne(ctx, name, spec, run);
    if (problem) { ctx.write(problem); return 1; }
    ctx.write(ctx.t.integrated(spec.spec, intBranch(name)));
  }
  return 0;
}
