// lib/gitprep.mjs — preparación Git CONSERVADORA para el flujo full-stack. Responsabilidad única: dejar
// un repo en una rama de feature limpia y al día, sin riesgo. Solo lectura + fast-forward + crear rama local.
// NUNCA hace push, commit, merge ni --force: ante cualquier duda, se detiene y reporta. El usuario decide.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Corre un comando git y captura código/salida (sin heredar stdio, para poder inspeccionar).
// Exportado: es EL runner git de chalc (lo reusan gitworktree y dashboard; no se duplica).
export function git(args, cwd) {
  return new Promise((res) => {
    let out = '', err = '';
    const child = spawn('git', args, { cwd });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => res({ code: -1, out: '', err: 'git no disponible' }));
    child.on('exit', (code) => res({ code: code ?? -1, out: out.trim(), err: err.trim() }));
  });
}

// Estado del repo: si es repo, rama actual, árbol limpio, y relación con el upstream (ahead/behind).
export async function gitStatus(repoDir) {
  if (!existsSync(join(repoDir, '.git'))) {
    const top = await git(['rev-parse', '--is-inside-work-tree'], repoDir);
    if (top.code !== 0 || top.out !== 'true') return { isRepo: false };
  }
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir)).out;
  const clean = (await git(['status', '--porcelain'], repoDir)).out === '';
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoDir);
  const hasUpstream = upstream.code === 0;
  let ahead = 0, behind = 0;
  if (hasUpstream) {
    const counts = await git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], repoDir);
    if (counts.code === 0) { const [a, b] = counts.out.split(/\s+/).map(Number); ahead = a || 0; behind = b || 0; }
  }
  return { isRepo: true, branch, clean, hasUpstream, ahead, behind };
}

// Trae cambios y avanza la rama base SOLO si es fast-forward sobre árbol limpio. Devuelve { ok, reason, status }.
// reason ∈ 'not-a-repo' | 'dirty' | 'no-upstream' | 'fetch-failed' | 'diverged' | 'up-to-date' | 'fast-forwarded'.
export async function safePull(repoDir) {
  const status = await gitStatus(repoDir);
  if (!status.isRepo) return { ok: false, reason: 'not-a-repo', status };
  if (!status.clean) return { ok: false, reason: 'dirty', status };          // hay cambios sin commitear: no tocar
  if (!status.hasUpstream) return { ok: false, reason: 'no-upstream', status };
  const fetched = await git(['fetch'], repoDir);
  if (fetched.code !== 0) return { ok: false, reason: 'fetch-failed', status };
  const after = await gitStatus(repoDir);
  if (after.behind === 0) return { ok: true, reason: 'up-to-date', status: after };
  if (after.ahead > 0) return { ok: false, reason: 'diverged', status: after };   // hay commits locales: el merge lo decide el usuario
  const ff = await git(['merge', '--ff-only', '@{u}'], repoDir);
  if (ff.code !== 0) return { ok: false, reason: 'diverged', status: after };
  return { ok: true, reason: 'fast-forwarded', status: await gitStatus(repoDir) };
}

// Crea (o reutiliza) una rama de feature desde la rama actual. No pisa trabajo: si ya existe, solo cambia a ella.
// Devuelve { ok, reason, branch }. reason ∈ 'not-a-repo' | 'created' | 'switched' | 'checkout-failed'.
export async function createFeatureBranch(repoDir, branchName) {
  const status = await gitStatus(repoDir);
  if (!status.isRepo) return { ok: false, reason: 'not-a-repo', branch: branchName };
  if (status.branch === branchName) return { ok: true, reason: 'switched', branch: branchName };
  const exists = (await git(['rev-parse', '--verify', '--quiet', branchName], repoDir)).code === 0;
  const checkout = exists
    ? await git(['checkout', branchName], repoDir)
    : await git(['checkout', '-b', branchName], repoDir);
  if (checkout.code !== 0) return { ok: false, reason: 'checkout-failed', branch: branchName };
  return { ok: true, reason: exists ? 'switched' : 'created', branch: branchName };
}
