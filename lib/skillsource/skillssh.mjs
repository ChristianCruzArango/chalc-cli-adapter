// lib/skillsource/skillssh.mjs — descarga una skill con la CLI de skills.sh (`npx skills add`) a una
// temporal. `exec` y `home` son inyectables para probar sin red ni tocar el HOME real.

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { portable } from '../proc.mjs';
import { childEnv } from '../childenv.mjs';
import { t } from '../i18n.mjs';
import { snapshotRoots, collectChanges } from './snapshot.mjs';

// La CLI de skills.sh, en una versión FIJA. `npx --yes skills` ejecutaba la última publicada en cada
// instalación: cualquier versión nueva —o comprometida— corría con los permisos del usuario. Se fija
// una con semanas de recorrido; subirla es una decisión explícita en este archivo.
export const SKILLS_CLI = 'skills@1.7.0';

// Tope para `npx skills add` (S2): sin él, una descarga colgada bloqueaba chalc para siempre.
export const SKILLS_TIMEOUT = 300000;

function splitArgs(input) {
  const out = [];
  input.replace(/"([^"]*)"|'([^']*)'|(\S+)/g, (_m, dq, sq, bare) => {
    out.push(dq ?? sq ?? bare);
    return '';
  });
  return out;
}

function skillsCliArgs(source) {
  const args = splitArgs(source.trim());
  if (args[0] === 'npx') args.shift();
  if (args[0] === '--yes' || args[0] === '-y') args.shift();
  if (args[0] === 'add-skill') return [SKILLS_CLI, 'add', ...args.slice(1)];
  if (/^skills(@|$)/.test(args[0] || '') && args[1] === 'add') return [SKILLS_CLI, ...args.slice(1)];
  return [SKILLS_CLI, 'add', source];
}

export async function skillsShFetch(name, { log = () => {}, exec = execFileSync, home = homedir() } = {}) {
  const tmp = await mkdtemp(join(tmpdir(), 'chalc-skills-'));
  const localRoot = join(tmp, '.agents', 'skills');
  // La CLI instala también en ~/.claude/skills o ~/.codex/skills: lo que deje ahí no lo pidió el
  // usuario, y una skill suya con el mismo id no puede quedar pisada.
  const snaps = await snapshotRoots([join(home, '.claude', 'skills'), join(home, '.codex', 'skills')], join(tmp, '.chalc-home-backup'));
  const args = skillsCliArgs(name);
  // En Windows npx es un shim .cmd: `portable` lo lanza por cmd.exe citando cada argumento y
  // rechazando los metacaracteres (lib/proc.mjs). Entorno filtrado (S2): sin las API keys del usuario.
  log(`npx ${args.join(' ')} …`);
  try {
    let changes;
    try {
      exec(...portable('npx', ['--yes', ...args], { cwd: tmp, stdio: 'inherit', env: childEnv(), timeout: SKILLS_TIMEOUT }));
    } finally {
      changes = await collectChanges(snaps, join(tmp, '.chalc-home-strays'));
    }
    for (const id of changes.restored) log(t('instHomeSkillRestored', id));
    // Solo cuenta lo que la CLI dejó en la temporal o lo que añadió/cambió en el HOME: ya no hay
    // fallback a una skill local intacta con el id pedido, que se vendorizaba como si fuera remota.
    const local = existsSync(localRoot) ? (await readdir(localRoot)).map((n) => join(localRoot, n)) : [];
    const dirs = [...local, ...changes.dirs];
    if (!dirs.length) throw new Error(t('instSkillsAddEmpty'));
    return { dirs, cleanup: tmp };
  } catch (error) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
