// lib/install.mjs — instala skills desde Git/GitHub o skills.sh y los vendoriza al catálogo de Chalc.
// "Vendorizar" = copiar el contenido REAL (dereferenciando symlinks) a catalog/skills/<id>,
// para que el skill viaje con Chalc y sea portátil.

import { cp, readdir, mkdtemp, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { join, basename, relative, resolve, isAbsolute } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertSafeId } from './ids.mjs';
import { portable } from './proc.mjs';
import { t } from './i18n.mjs';

// ¿`target` está dentro de `base` (o es `base`)? Por segmentos, no con `startsWith`: `/tmp/a` no
// contiene a `/tmp/ab`.
const within = (base, target) => {
  const rel = relative(base, target);
  return rel === '' || (rel.split(/[\\/]/)[0] !== '..' && !isAbsolute(rel));
};

// Una skill descargada no puede llevar enlaces que salgan de ella. La copia sigue los enlaces
// (`dereference`), así que un `ref.md -> ~/.ssh/id_rsa` metía el contenido REAL de esa clave en
// `catalog/skills/<id>`, que se versiona y se distribuye. Los enlaces internos se aceptan.
export async function assertNoEscapingLinks(root) {
  const realRoot = realpathSync(root);
  const walk = async (dir) => {
    for (const entry of await readdir(dir)) {
      const abs = join(dir, entry);
      const st = await lstat(abs);
      if (st.isSymbolicLink()) {
        let real;
        try { real = realpathSync(abs); } catch { throw new Error(t('instBrokenLink', relative(root, abs))); }
        if (!within(realRoot, real)) throw new Error(t('instEscapingLink', relative(root, abs)));
      } else if (st.isDirectory()) {
        await walk(abs);
      }
    }
  };
  await walk(root);
}

// Copia una skill ya validada: sin enlaces que escapen, la copia siguiendo enlaces es segura.
export async function copySkillTree(src, dest, opts = {}) {
  await assertNoEscapingLinks(src);
  await cp(src, dest, { recursive: true, dereference: true, ...opts });
}

export function classifySource(s) {
  if (/^(npx\s+)?(add-skill|skills\s+add)\b/.test(s.trim())) return 'skillssh';
  if (/^(https?:\/\/|git@)/.test(s) && /(github\.com|gitlab\.com|bitbucket\.org|\.git)(\/|:|$)/.test(s)) return 'git';
  if (existsSync(resolve(s))) return 'local';
  return 'skillssh';
}

function splitArgs(input) {
  const out = [];
  input.replace(/"([^"]*)"|'([^']*)'|(\S+)/g, (_m, dq, sq, bare) => {
    out.push(dq ?? sq ?? bare);
    return '';
  });
  return out;
}

// La CLI de skills.sh, en una versión FIJA. `npx --yes skills` ejecutaba la última publicada en cada
// instalación: cualquier versión nueva —o comprometida— corría con los permisos del usuario. Se fija
// una con semanas de recorrido; subirla es una decisión explícita en este archivo.
export const SKILLS_CLI = 'skills@1.7.0';

function skillsCliArgs(source) {
  const args = splitArgs(source.trim());
  if (args[0] === 'npx') args.shift();
  if (args[0] === '--yes' || args[0] === '-y') args.shift();
  if (args[0] === 'add-skill') return [SKILLS_CLI, 'add', ...args.slice(1)];
  if (/^skills(@|$)/.test(args[0] || '') && args[1] === 'add') return [SKILLS_CLI, ...args.slice(1)];
  return [SKILLS_CLI, 'add', source];
}

function requestedSkillId(source) {
  const args = splitArgs(source.trim());
  const skillIdx = args.findIndex((arg) => arg === '--skill' || arg === '-s');
  if (skillIdx >= 0 && args[skillIdx + 1]) return args[skillIdx + 1];
  return null;
}

function parseGithub(url) {
  // owner/repo, owner/repo.git, owner/repo/tree/<ref>/<subpath>
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)\/(.+))?$/);
  if (!m) return { repo: url, ref: null, subpath: null };
  return { repo: `https://github.com/${m[1]}/${m[2]}.git`, ref: m[3] || null, subpath: m[4] || null };
}

async function gitFetch(url, log) {
  const { repo, ref, subpath } = parseGithub(url);
  // Un ref/subpath que empiece con '-' git lo tomaría como flag (--upload-pack=…); rechazar antes de ejecutar.
  if (ref && ref.startsWith('-')) throw new Error(t('instBadRef', ref));
  if (subpath && (subpath.startsWith('-') || subpath.split(/[/\\]/).includes('..'))) {
    throw new Error(t('instBadSubpath', subpath));
  }
  const tmp = await mkdtemp(join(tmpdir(), 'chalc-git-'));
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push('--', repo, tmp);   // '--' cierra el parseo de flags: repo/tmp nunca se interpretan como opciones
  log(`git clone ${repo}${ref ? ' @ ' + ref : ''} …`);
  execFileSync('git', args, { stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 120000 });
  // El commit exacto que se vendoriza: el lock lo registra para que la fuente sea reproducible.
  let commit = '';
  try { commit = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* sin commit legible */ }
  // El destino vendorizado se confina a tmp aunque subpath sea absoluto/raro, y por su ruta REAL:
  // `resolve` es léxico y no ve una subruta que atraviesa un directorio enlazado hacia fuera.
  const dir = subpath ? resolve(tmp, subpath) : tmp;
  let real;
  try { real = realpathSync(dir); } catch { throw new Error(t('instMissingSubpath', subpath)); }
  if (!within(realpathSync(tmp), real)) throw new Error(t('instOutsideSubpath', subpath));
  return { dir, cleanup: tmp, commit };
}

async function skillsShFetch(name, log) {
  const tmp = await mkdtemp(join(tmpdir(), 'chalc-skills-'));
  const skillRoots = [
    join(tmp, '.agents', 'skills'),
    join(homedir(), '.claude', 'skills'),
    join(homedir(), '.codex', 'skills')
  ];
  const before = new Map();
  for (const root of skillRoots) before.set(root, existsSync(root) ? await readdir(root) : []);
  const args = skillsCliArgs(name);
  // En Windows npx es un shim .cmd: `portable` lo lanza por cmd.exe citando cada argumento y
  // rechazando los metacaracteres (lib/proc.mjs).
  log(`npx ${args.join(' ')} …`);
  execFileSync(...portable('npx', ['--yes', ...args], { cwd: tmp, stdio: 'inherit' }));
  const dirs = [];
  for (const root of skillRoots) {
    const prev = before.get(root) || [];
    const after = existsSync(root) ? await readdir(root) : [];
    for (const added of after.filter((x) => !prev.includes(x))) {
      // La CLI instala también en ~/.claude/skills o ~/.codex/skills. Lo que dejó ahí no lo pidió el
      // usuario: se mueve a la carpeta temporal (que se borra al terminar) en vez de quedar instalado.
      if (root === skillRoots[0]) { dirs.push(join(root, added)); continue; }
      const moved = join(tmp, '.chalc-home-strays', basename(root.replace(/[\\/]skills$/, '')), added);
      await cp(join(root, added), moved, { recursive: true });
      await rm(join(root, added), { recursive: true, force: true });
      dirs.push(moved);
    }
  }
  const requested = requestedSkillId(name);
  if (!dirs.length && requested) {
    for (const root of skillRoots) {
      const dir = join(root, requested);
      if (existsSync(join(dir, 'SKILL.md'))) dirs.push(dir);
    }
  }
  if (!dirs.length) throw new Error(t('instSkillsAddEmpty'));
  return { dirs, cleanup: tmp };
}

async function confirmExternalExec({ kind, source, prompter, allowExternalExec }) {
  if (kind === 'local') return;
  const command = kind === 'git' ? 'git clone' : `npx --yes ${SKILLS_CLI} add`;
  if (allowExternalExec) return;
  if (!prompter) {
    throw new Error(t('instNeedsExec', command));
  }
  const ok = await prompter.yesno(`La fuente "${source}" requiere ejecutar "${command}". ¿Continuar?`, false);
  if (!ok) throw new Error(t('instCancelled'));
}

async function findSkillDirs(dir) {
  if (!existsSync(dir)) return [];
  if (existsSync(join(dir, 'SKILL.md'))) return [dir];
  const out = [];
  const scan = async (base) => {
    if (!existsSync(base)) return;
    for (const e of await readdir(base, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(base, e.name, 'SKILL.md'))) out.push(join(base, e.name));
    }
  };
  await scan(dir);
  await scan(join(dir, 'skills'));
  return out;
}

// Versión del cálculo de `hashDir`. Se guarda en el manifiesto: un hash de otra versión no se compara
// con uno de esta (ver checkSkillUpdate).
export const HASH_VERSION = 2;

// Exportado: `chalc update` compara este mismo hash para decidir si una skill cambió en su fuente.
//
// Igual en todos los SO (F-18): la ruta va con `/` (en Windows `relative` da `a\b`); cada archivo se
// delimita con su nombre y su longitud (sin delimitador, `a`+`bc` y `ab`+`c` daban lo mismo); y un
// archivo de texto se normaliza a LF, porque git lo reescribe con CRLF al hacer checkout en Windows.
export async function hashDir(dir) {
  const hash = createHash('sha256');
  // Orden lexicográfico fijo: readdir no garantiza orden y el hash debe ser igual en todos los SO.
  const walk = async (base) => {
    const entries = (await readdir(base, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const file = join(base, e.name);
      const rel = relative(dir, file).replace(/\\/g, '/');
      if (rel === '.chalc-skill.json' || rel === '.chalc-managed') continue;
      if (e.isDirectory()) await walk(file);
      else {
        let content = await readFile(file);
        if (!content.includes(0)) content = Buffer.from(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
        hash.update(`${rel}\0${content.length}\0`);
        hash.update(content);
      }
    }
  };
  await walk(dir);
  return hash.digest('hex');
}

// Descarga/resuelve una fuente y devuelve los dirs con SKILL.md listos para vendorizar.
// Exportado: `chalc update` re-descarga con las MISMAS validaciones de seguridad que install.
// cleanup: carpeta temporal a borrar cuando termines con los dirs (null para fuentes locales).
export async function fetchSkillSource(source, { log = () => {} } = {}) {
  const kind = classifySource(source);
  if (kind === 'git') {
    const r = await gitFetch(source, log);
    return { kind, dirs: await findSkillDirs(r.dir), cleanup: r.cleanup, commit: r.commit };
  }
  if (kind === 'local') {
    return { kind, dirs: await findSkillDirs(resolve(source)), cleanup: null };
  }
  const r = await skillsShFetch(source, log);
  return { kind, dirs: r.dirs, cleanup: r.cleanup };
}

// Procedencia del skill instalado: de dónde vino y la huella de su contenido (para `update`/`doctor`).
async function writeSkillMeta(dest, { id, source, kind, commit }) {
  await writeFile(join(dest, '.chalc-skill.json'), JSON.stringify({
    id,
    source,
    sourceType: kind,
    ...(commit ? { commit } : {}),
    contentSha256: await hashDir(dest),
    hashVersion: HASH_VERSION,
    installedAt: new Date().toISOString()
  }, null, 2) + '\n');
}

// Devuelve los ids de skills copiados al catálogo.
export async function installSkill({ source, CATALOG, prompter, force = false, allowExternalExec = false, log = () => {} }) {
  const kind = classifySource(source);
  await confirmExternalExec({ kind, source, prompter, allowExternalExec });
  const { dirs, cleanup, commit = '' } = await fetchSkillSource(source, { log });

  try {
    if (!dirs.length) throw new Error(t('instNoSkill'));
    let chosen = dirs;
    if (dirs.length > 1 && prompter) {
      const idxs = await prompter.multi('Encontré varios skills, ¿cuáles instalar?', dirs.map((d) => ({ label: basename(d) })), dirs.map((_, i) => i));
      chosen = idxs.map((i) => dirs[i]);
    }
    const installed = [];
    for (const d of chosen) {
      const id = assertSafeId(basename(d), 'skill id');
      const dest = join(CATALOG, 'skills', id);
      if (existsSync(dest) && !force) {
        if (!prompter) throw new Error(t('instExists', id));
        const replace = await prompter.yesno(`El skill "${id}" ya existe. ¿Reemplazarlo?`, false);
        if (!replace) {
          log(`${id}: se conserva el existente`);
          continue;
        }
      }
      await copySkillTree(d, dest, { force: true });
      await writeSkillMeta(dest, { id, source, kind, commit });
      installed.push(id);
    }
    return installed;
  } finally {
    if (cleanup) await rm(cleanup, { recursive: true, force: true }).catch(() => {});
  }
}
