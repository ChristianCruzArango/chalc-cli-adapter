// lib/gitprep.mjs — preparación Git CONSERVADORA para el flujo full-stack. Responsabilidad única: dejar
// un repo en una rama de feature limpia y al día, sin riesgo. Solo lectura + fast-forward + crear rama local.
// NUNCA hace push, commit, merge ni --force: ante cualquier duda, se detiene y reporta. El usuario decide.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// git sin terminal: sin esto, un `fetch` contra un remoto que pide credenciales se queda esperando
// una contraseña que nadie va a escribir.
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' };
const GIT_TIMEOUT_MS = 120000;

// Defensa en profundidad (R-01): una `.git/config` ajena u hostil no debe ejecutar nada cuando chalc
// solo INSPECCIONA. `core.fsmonitor` corre un comando en cada status/diff; en los comandos que
// muestran diffs, `--no-ext-diff` anula diff.external y diff.<driver>.command, y `--no-textconv` los
// conversores de .gitattributes. (`-c diff.external=` vacío NO lo desactiva: git intentaría ejecutarlo.)
const SAFE_CONFIG = ['-c', 'core.fsmonitor=false'];
const DIFF_COMMANDS = new Set(['diff', 'log', 'show']);
export function safeGitArgs([sub, ...rest]) {
  const noExternal = DIFF_COMMANDS.has(sub) ? ['--no-ext-diff', '--no-textconv'] : [];
  return [...SAFE_CONFIG, sub, ...noExternal, ...rest];
}

// Corre un comando git y captura código/salida (sin heredar stdio, para poder inspeccionar).
// Exportado: es EL runner git de chalc (lo reusan gitworktree y dashboard; no se duplica).
export function git(args, cwd, { timeoutMs = GIT_TIMEOUT_MS } = {}) {
  return new Promise((res) => {
    let out = '', err = '';
    const child = spawn('git', safeGitArgs(args), { cwd, env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { err += '\ngit: tiempo agotado'; child.kill('SIGKILL'); }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => { clearTimeout(timer); res({ code: -1, out: '', err: 'git no disponible' }); });
    child.on('exit', (code) => { clearTimeout(timer); res({ code: code ?? -1, out: out.trim(), err: err.trim() }); });
  });
}

// ¿La consulta de upstream falló por algo que NO es «no hay upstream»? Rama sin upstream, repo sin
// commits (`no such branch`) y upstream borrado en el remoto (`not stored as a remote-tracking
// branch`) son estados normales; cualquier otro fallo es un error de git (C-02). Pura: se prueba sola.
const NO_UPSTREAM = /no upstream configured|no such branch|not stored as a remote-tracking branch/i;
export const upstreamProblem = ({ code, err }) => code !== 0 && !NO_UPSTREAM.test(err);

// Estado del repo: si es repo, rama actual, árbol limpio, y relación con el upstream (ahead/behind).
// `error` (solo si algo falló) dice que git no pudo responder: un índice corrupto hacía fallar
// `status` con salida vacía y se leía como «limpio» (C-02). Con error, `clean` es false.
// Que `rev-parse HEAD` falle en un repo sin commits es normal y no cuenta como error.
export async function gitStatus(repoDir) {
  if (!existsSync(join(repoDir, '.git'))) {
    const top = await git(['rev-parse', '--is-inside-work-tree'], repoDir);
    if (top.code !== 0 || top.out !== 'true') return { isRepo: false };
  }
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir)).out;
  const status = await git(['status', '--porcelain'], repoDir);
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoDir);
  const error = status.code !== 0 ? `status-failed: ${status.err}`
    : upstreamProblem(upstream) ? `upstream-failed: ${upstream.err}` : '';
  if (error) return { isRepo: true, branch, clean: false, hasUpstream: false, ahead: 0, behind: 0, error };
  const clean = status.out === '';
  const hasUpstream = upstream.code === 0;
  let ahead = 0, behind = 0;
  if (hasUpstream) {
    const counts = await git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], repoDir);
    if (counts.code === 0) { const [a, b] = counts.out.split(/\s+/).map(Number); ahead = a || 0; behind = b || 0; }
  }
  return { isRepo: true, branch, clean, hasUpstream, ahead, behind };
}

// Trae cambios y avanza la rama base SOLO si es fast-forward sobre árbol limpio. Devuelve { ok, reason, status }.
// reason ∈ 'not-a-repo' | 'git-error' | 'dirty' | 'no-upstream' | 'fetch-failed' | 'diverged' | 'up-to-date' | 'fast-forwarded'.
export async function safePull(repoDir) {
  const status = await gitStatus(repoDir);
  if (!status.isRepo) return { ok: false, reason: 'not-a-repo', status };
  if (status.error) return { ok: false, reason: 'git-error', status };     // git no pudo responder: no se da nada por bueno
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
