// test/helpers/teamrepo.mjs — un repo de prueba con specs aprobadas para los tests del equipo (specs 033+).
// Responsabilidad ÚNICA: escribir carpetas de spec con su `Toca:` y su sello, y correr `team.mjs` contra ellas.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { coherentSpec, coherentTexts } from './coherentspec.mjs';
import { main } from '../../catalog/team/team.mjs';

/** Escribe en `root` el mapa `ruta → contenido`. */
export async function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, ...rel.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}

/** Los archivos de una spec en `specs/<name>` cuyo plan declara `touches` y `dependsOn`. `sealed: false` la deja sin aprobar. */
export function specFiles(name, { touches = [], dependsOn = [], sealed = true, surface = '' } = {}) {
  const plan = ['# Plan', '', 'Cubre R1.', '', ...(surface ? [`Superficie: ${surface}`] : []), ...(touches.length ? [`Toca: ${touches.join(', ')}`] : []), ...(dependsOn.length ? [`Depende de: ${dependsOn.join(', ')}`] : []), ''].join('\n');
  // Una spec con interfaz trae su design.md, sellado con ella (spec 038).
  const design = surface === 'ui' ? { 'design.md': '# Diseño\n\n## Pantalla: pago\n- Primario: «Pagar»\n' } : {};
  return coherentSpec(`specs/${name}`, { sealed, red: false, texts: { ...coherentTexts(), 'plan.md': plan, ...design } });
}

/** Corre `team.mjs` en `cwd` con `args`. Devuelve { code, text }. */
export async function team(cwd, ...args) {
  const lines = [];
  const code = await main({ argv: ['node', 'team.mjs', ...args], cwd, write: (line) => lines.push(line) });
  return { code, text: lines.join('\n') };
}

/** Un `gate.json` mínimo en español. */
export const GATE_ES = { '.chalc/gate.json': JSON.stringify({ language: 'es', spec: { dir: 'specs' } }) };

// ── git ───────────────────────────────────────────────────────────────────────────────────────────
// Los tests del equipo no usan el historial de este repo: cada uno crea el suyo (CI clona con --depth 1).

import { spawnSync } from 'node:child_process';

/** Corre git en `cwd` con una identidad de prueba. Devuelve { status, out }. */
export function git(cwd, ...args) {
  const run = spawnSync('git', ['-c', 'user.name=chalc', '-c', 'user.email=test@chalc.dev', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  return { status: run.status, out: `${run.stdout || ''}${run.stderr || ''}`.trim() };
}

/** Commitea todo lo que haya en `cwd`. Devuelve el commit. */
export function commitAll(cwd, message = 'cambio') {
  git(cwd, 'add', '-A');
  const done = git(cwd, 'commit', '-q', '-m', message);
  if (done.status !== 0) throw new Error(done.out);
  return git(cwd, 'rev-parse', 'HEAD').out;
}

/** Un repo de git en `<base>/repo` con `files` commiteados. Devuelve su ruta. */
export async function gitRepo(base, files) {
  const root = join(base, 'repo');
  await writeFiles(root, files);
  if (git(root, 'init', '-q').status !== 0) throw new Error('git init');
  // La identidad va en el repo: las herramientas del equipo corren git a secas (CI no tiene configuración global).
  for (const [key, value] of [['user.name', 'chalc'], ['user.email', 'test@chalc.dev'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(root, 'config', key, value);
  commitAll(root, 'base');
  return root;
}

/**
 * Deja en `wt` lo que una entrega exige (spec 034, R9): las tareas de `spec` marcadas y la evidencia de un portón
 * completo que aprobó el commit actual, y lo commitea. `state` cambia la evidencia (p. ej. `{ fast: true }`).
 */
export async function passGate(wt, spec, state = {}) {
  const { readFile } = await import('node:fs/promises');
  const tasks = join(wt, ...spec.split('/'), 'tasks.md');
  await writeFile(tasks, (await readFile(tasks, 'utf8')).replace(/\[ \]/g, '[x]'));
  const head = git(wt, 'rev-parse', 'HEAD').out;
  const evidence = { date: '2026-11-22T10:00:00.000Z', verdict: 'pass', fast: false, head, stages: [{ stage: 'tests', ok: true }, { stage: 'mutation', ok: true, score: 92 }], ...state };
  await writeFiles(wt, { '.chalc/gate.state.json': JSON.stringify(evidence), '.chalc/gate.md': '# portón\n' });
  return commitAll(wt, 'portón');
}

/** Lleva `spec` de programada a revisada: la empieza, commitea `files` en su worktree, la entrega y la firman `roles`. */
export async function reviewedSpec(root, spec, files, { roles = ['seguridad', 'revisor'], startArgs = [] } = {}) {
  const { appendEvent, readStatus } = await import('../../catalog/team/lib/ledger.mjs');
  const started = await team(root, 'start', '--spec', spec, ...startArgs);
  if (started.code !== 0) throw new Error(started.text);
  const wt = (await readStatus(root)).features.flatMap((f) => f.specs).find((s) => s.spec === spec).worktree;
  await writeFiles(wt, files);
  commitAll(wt, 'código');
  await passGate(wt, spec);
  const delivered = await team(wt, 'deliver', '--spec', spec);
  if (delivered.code !== 0) throw new Error(delivered.text);
  for (const role of roles) await appendEvent(root, { type: 'reviewed', spec, role, ok: true, findings: 0, summary: 'OK' });
  return wt;
}
