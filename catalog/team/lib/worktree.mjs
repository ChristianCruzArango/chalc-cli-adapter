// worktree.mjs — empezar una spec en su propio worktree (spec 033, R6, R7). Responsabilidad ÚNICA: comprobar que
// se puede empezar, crear el worktree con su rama y registrar el inicio. Razón de cambio: qué se exige para empezar.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Un worktree y una rama por SPEC, también cuando hay una sola: el desarrollador hace todas sus tareas ahí, en
// serie, y nadie trabaja sobre la rama del usuario. chalc no borra worktrees: eso es del usuario.

import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { option, parsePairs } from './cliargs.mjs';
import { maxParallel, readTeamConfig, roleConfig } from './config.mjs';
import { evidenceMerges } from './evidencemerge.mjs';
import { git } from './git.mjs';
import { appendEvent, readStatus } from './ledger.mjs';
import { worktreesBase } from './places.mjs';
import { normalPath } from './scope.mjs';

const ACTIVE_SPEC = '.chalc/active-spec';
const nameOf = (spec) => spec.split('/').pop();

/** La rama de trabajo de una spec. */
export const branchOf = (spec) => `chalc/${nameOf(spec)}`;

// La spec en el estado, con las de su feature. null si nadie la registró.
function located(status, spec) {
  const feature = status.features.find((f) => f.specs.some((s) => s.spec === spec));
  return feature ? { feature: feature.feature, found: feature.specs.find((s) => s.spec === spec), siblings: feature.specs } : null;
}

// Por qué no se puede empezar: [problema, dato], o null.
function whyNot(root, spec, place, target) {
  if (!place || place.found.state !== 'scheduled') return ['not-scheduled', spec];
  if (target.busy >= target.cap) return ['parallel-cap', target.cap];
  const pending = place.siblings.find((s) => s.wave !== null && s.wave < place.found.wave && s.state !== 'integrated');
  if (pending) return ['earlier-wave-pending', pending.spec];
  if (!git(root, ['rev-parse', '--verify', 'HEAD']).ok) return ['no-git'];
  // El worktree sale de lo commiteado: una spec o un sello sin commitear no llegarían a él.
  if (git(root, ['status', '--porcelain', '--', spec, '.chalc/seals']).out) return ['spec-uncommitted', spec];
  if (git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${target.branch}`]).ok) return ['branch-exists', target.branch];
  if (existsSync(target.dir)) return ['worktree-exists', target.dir];
  return null;
}

// Fija `spec` como la activa del worktree SIN ensuciarlo: si el repo versiona ese archivo, git deja de mirarlo
// aquí; si no, se ignora en local. La spec activa de un worktree nunca viaja en un commit.
async function pinSpec(dir, spec) {
  await mkdir(join(dir, '.chalc'), { recursive: true });
  await writeFile(join(dir, ...ACTIVE_SPEC.split('/')), `${spec}\n`, 'utf8');
  if (git(dir, ['ls-files', '--error-unmatch', ACTIVE_SPEC]).ok) { git(dir, ['update-index', '--skip-worktree', ACTIVE_SPEC]); return; }
  const exclude = resolve(dir, git(dir, ['rev-parse', '--git-path', 'info/exclude']).out);
  const current = await readFile(exclude, 'utf8').catch(() => '');
  if (current.split(/\r?\n/).includes(ACTIVE_SPEC)) return;
  await mkdir(dirname(exclude), { recursive: true });
  await appendFile(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${ACTIVE_SPEC}\n`, 'utf8');
}

/** `team.mjs start --spec <carpeta> [--base <ref>] [launcher=… tier=…]`. Devuelve el código de salida. */
export async function startSpec(ctx) {
  const spec = normalPath(option(ctx.args, '--spec'));
  if (!spec) { ctx.write(ctx.t.startUsage); return 1; }
  const [status, config] = [await readStatus(ctx.root, { now: ctx.now }), await readTeamConfig(ctx.root)];
  // Cuántas specs hay ya en desarrollo, contra el tope: cada una es un desarrollador gastando a la vez.
  const busy = status.features.flatMap((f) => f.specs).filter((s) => s.state === 'in_dev').length;
  const target = { branch: branchOf(spec), dir: join(await worktreesBase(ctx.root), nameOf(spec)), busy, cap: maxParallel(config) };
  const place = located(status, spec);
  const refused = whyNot(ctx.root, spec, place, target);
  if (refused) { ctx.write(ctx.t.problems[refused[0]](refused[1])); return 1; }
  // Sobre lo ya integrado de la feature, si lo hay (spec 035, R7): una ola posterior parte de las anteriores.
  const integration = `refs/heads/chalc/int-${place.feature}`;
  const from = option(ctx.args, '--base') || (git(ctx.root, ['rev-parse', '--verify', '--quiet', integration]).ok ? integration : 'HEAD');
  const base = git(ctx.root, ['rev-parse', '--verify', `${from}^{commit}`]);
  const added = base.ok ? git(ctx.root, ['worktree', 'add', '-q', '-b', target.branch, target.dir, base.out]) : base;
  if (!added.ok) { ctx.write(ctx.t.problems['worktree-failed'](added.err)); return 1; }
  await pinSpec(target.dir, spec);
  // Para que traer lo integrado a esta rama no choque en los informes del portón (spec 035, R4).
  await evidenceMerges(ctx.root);
  const { launcher, tier } = { ...roleConfig(config, 'desarrollador'), ...parsePairs(ctx.args) };
  await appendEvent(ctx.root, { type: 'started', spec, worktree: target.dir, branch: target.branch, launcher, tier, base: base.out }, { now: ctx.now });
  ctx.write(ctx.t.started(spec, target));
  return 0;
}
