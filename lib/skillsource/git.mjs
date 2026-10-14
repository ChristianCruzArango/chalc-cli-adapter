// lib/skillsource/git.mjs — descarga una skill desde un repo git (GitHub u otro host) a una temporal.
// `exec` es inyectable (execFileSync por defecto) para probar sin red.

import { mkdtemp, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { childEnv } from '../childenv.mjs';
import { t } from '../i18n.mjs';
import { within } from './within.mjs';
import { splitPin } from './pin.mjs';

const GIT_TIMEOUT = 120000;

function parseGithub(url) {
  // owner/repo, owner/repo.git, owner/repo/tree/<ref>/<subpath>
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)\/(.+))?$/);
  if (!m) return { repo: url, ref: null, subpath: null };
  return { repo: `https://github.com/${m[1]}/${m[2]}.git`, ref: m[3] || null, subpath: m[4] || null };
}

export async function gitFetch(url, { log = () => {}, exec = execFileSync } = {}) {
  const { base, pin } = splitPin(url);
  const { repo, ref, subpath } = parseGithub(base);
  // Un ref/subpath que empiece con '-' git lo tomaría como flag (--upload-pack=…); rechazar antes de ejecutar.
  if (ref && ref.startsWith('-')) throw new Error(t('instBadRef', ref));
  if (subpath && (subpath.startsWith('-') || subpath.split(/[/\\]/).includes('..'))) {
    throw new Error(t('instBadSubpath', subpath));
  }
  const tmp = await mkdtemp(join(tmpdir(), 'chalc-git-'));
  // Si algo falla, la temporal no queda huérfana.
  try {
    // Entorno filtrado (S2): git y sus hooks/helpers no heredan las API keys del usuario.
    const env = childEnv({ GIT_TERMINAL_PROMPT: '0' });
    // Un commit fijo no se alcanza con --depth 1: se clona la historia y se hace checkout de ese commit.
    const args = pin ? ['clone'] : ['clone', '--depth', '1'];
    if (ref) args.push('--branch', ref);
    args.push('--', repo, tmp);   // '--' cierra el parseo de flags: repo/tmp nunca se interpretan como opciones
    log(`git clone ${repo}${ref ? ' @ ' + ref : ''}${pin ? ' # ' + pin : ''} …`);
    exec('git', args, { stdio: 'ignore', env, timeout: GIT_TIMEOUT });
    if (pin) exec('git', ['-C', tmp, 'checkout', '--detach', pin], { stdio: 'ignore', env, timeout: GIT_TIMEOUT });
    // El commit exacto que se vendoriza: el lock lo registra para que la fuente sea reproducible.
    let commit = '';
    try { commit = String(exec('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8', env, timeout: GIT_TIMEOUT })).trim(); } catch { /* sin commit legible */ }
    if (pin && !commit.toLowerCase().startsWith(pin)) throw new Error(t('instPinMismatch', pin));
    // El destino vendorizado se confina a tmp aunque subpath sea absoluto/raro, y por su ruta REAL:
    // `resolve` es léxico y no ve una subruta que atraviesa un directorio enlazado hacia fuera.
    const dir = subpath ? resolve(tmp, subpath) : tmp;
    let real;
    try { real = realpathSync(dir); } catch { throw new Error(t('instMissingSubpath', subpath)); }
    if (!within(realpathSync(tmp), real)) throw new Error(t('instOutsideSubpath', subpath));
    return { dir, cleanup: tmp, commit };
  } catch (error) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
