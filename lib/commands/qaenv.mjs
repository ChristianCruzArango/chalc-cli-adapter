// Entorno de la app para `chalc qa`: levantarlo, esperar a que responda, bajarlo, y correr contra él
// el spec de Playwright que deja el agente.

import { spawn } from 'node:child_process';
import { t } from '../i18n.mjs';
import { buildStartCommand, notAnswering, waitForAny } from '../qa.mjs';
import { killTree, portable } from '../proc.mjs';
import { c } from './context.mjs';

const HEALTH_ATTEMPTS = 120;   // un intento por segundo: un MFE grande compila lento
const ANNOUNCED_URL = [/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i, /listening on\s+(?:localhost|127\.0\.0\.1):(\d+)/i];

async function healthCandidates(healthUrls, guessed) {
  const urls = (Array.isArray(healthUrls) ? healthUrls : [healthUrls]).filter(Boolean);
  if (!guessed) return urls;
  const free = await notAnswering(urls);
  for (const url of urls.filter((u) => !free.includes(u))) console.log(c.dim('  ' + t('qaPortTaken', url)));
  return free;
}

function runToEnd(cmd, args, cwd) {
  return new Promise((res) => {
    const p = spawn(...portable(cmd, args, { cwd, stdio: 'ignore' }));
    p.on('error', () => res(-1));
    p.on('exit', (code) => res(code ?? -1));
  });
}

// Lanza el comando de arranque y vigila su salida: anota la URL que el propio dev server anuncia y
// reenvía las líneas de error o de compilación. Devuelve el estado vivo del proceso.
function launch(start, proj) {
  const run = { child: null, discovered: null, exited: false, spawnError: null };
  const onData = (buf) => {
    const text = buf.toString();
    if (!run.discovered) {
      const m = text.match(ANNOUNCED_URL[0]) || text.match(ANNOUNCED_URL[1]);
      if (m) { run.discovered = `http://localhost:${m[1]}`; console.log(c.dim('  │ ' + t('qaUrlDetected', run.discovered))); }
    }
    for (const line of text.split('\n')) if (/error|failed|cannot|compiled|Port \d+ is already/i.test(line)) { const l = line.trim(); if (l) console.log(c.dim(`  │ ${l.slice(0, 160)}`)); }
  };
  // NG_CLI_ANALYTICS=false evita el prompt de analytics de Angular que cuelga en modo no interactivo.
  run.child = spawn(...portable(start.command, start.args, { cwd: proj, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: { ...process.env, NG_CLI_ANALYTICS: 'false' } }));
  run.child.stdout?.on('data', onData);
  run.child.stderr?.on('data', onData);
  run.child.on('error', (e) => { run.spawnError = e; run.exited = true; });
  run.child.on('exit', () => { run.exited = true; });
  return run;
}

// Prioriza la URL anunciada por el server; cae a los candidatos del guess. Si el proceso que no se
// baja con `down` (un dev server en primer plano) ya terminó, no hay nada que esperar.
function waitHealthy(run, start, candidates) {
  return waitForAny(() => [run.discovered, ...candidates], {
    attempts: HEALTH_ATTEMPTS,
    shouldAbort: () => start.down === null && run.exited
  });
}

function reportHealth(health, run, command, candidates) {
  if (run.spawnError) console.log(c.red('✗ ' + t('qaCannotRun', command, run.spawnError.code || run.spawnError.message)));
  else if (health.ok) console.log(c.green('✓ ' + t('qaResponds', health.url, health.status, health.attempts)));
  else if (health.aborted) console.log(c.red('✗ ' + t('qaProcessEnded')));
  else console.log(c.red('✗ ' + t('qaNoUrlResponded', run.discovered || t('qaNoneFem'), candidates.join(' | ') || '—')));
}

async function stopEnvironment(run, start, proj) {
  console.log(c.dim('  ' + t('qaStoppingEnv')));
  if (start.down) { await runToEnd(start.down.command, start.down.args, proj); return; }
  if (!run.exited && !run.child.killed) killTree(run.child, 'SIGTERM');
}

// Levanta el entorno y espera a que la URL responda. Devuelve { health, stop }: el caller decide cuándo bajarlo.
// NO fuerza el puerto: lee la URL que el propio dev server anuncia (ng/vite/next la imprimen), así respeta
// la config de la app — forzar un puerto random rompe Module Federation (el remoteEntry queda apuntando al viejo).
// `guessed`: las URL candidatas son una suposición (no las dio el usuario con --url); las que ya
// respondían ANTES de lanzar son de otro servicio y se descartan.
export async function startEnvironment(env, proj, healthUrls, { guessed = false } = {}) {
  const start = buildStartCommand(env);   // lanza si el entorno no es arrancable
  const candidates = await healthCandidates(healthUrls, guessed);
  console.log('\n▶ ' + t('qaStarting', c.bold(`${start.command} ${start.args.join(' ')}`)) + '  ' + c.dim('· ' + t('qaDiscoveringUrl')));
  const run = launch(start, proj);
  const health = await waitHealthy(run, start, candidates);
  reportHealth(health, run, start.command, candidates);
  return { health, stop: () => stopEnvironment(run, start, proj) };
}

// Bring-up de un solo tiro (para --up): levanta, verifica salud y baja inmediatamente.
export async function bringUpEnvironment(env, proj, healthUrl, opts) {
  const { health, stop } = await startEnvironment(env, proj, healthUrl, opts);
  await stop();
  return health;
}

// Ejecuta un spec con el CLI de Playwright del proyecto (la app debe estar viva). Devuelve el exit code.
export function runPlaywrightSpec(proj, testFile, baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(...portable('npx', ['playwright', 'test', testFile, '--reporter=line'], {
      cwd: proj,
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BASE_URL: baseUrl, BASE_URL: baseUrl }
    }));
    child.on('error', () => resolve(-1));
    child.on('exit', (code) => resolve(code ?? -1));
  });
}
