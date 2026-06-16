// lib/install.mjs — instala skills desde Git/GitHub o skills.sh y los vendoriza al catálogo de Chalc.
// "Vendorizar" = copiar el contenido REAL (dereferenciando symlinks) a catalog/skills/<id>,
// para que el skill viaje con Chalc y sea portátil.

import { cp, readdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, relative, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertSafeId } from './ids.mjs';

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

function skillsCliArgs(source) {
  const args = splitArgs(source.trim());
  if (args[0] === 'npx') args.shift();
  if (args[0] === 'add-skill') return ['skills', 'add', ...args.slice(1)];
  if (args[0] === 'skills' && args[1] === 'add') return args;
  return ['skills', 'add', source];
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
  const tmp = await mkdtemp(join(tmpdir(), 'chalc-git-'));
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push(repo, tmp);
  log(`git clone ${repo}${ref ? ' @ ' + ref : ''} …`);
  execFileSync('git', args, { stdio: 'ignore' });
  return { dir: subpath ? join(tmp, subpath) : tmp, cleanup: tmp };
}

async function skillsShFetch(name, log, CATALOG) {
  const tmp = await mkdtemp(join(tmpdir(), 'chalc-skills-'));
  const skillRoots = [
    join(tmp, '.agents', 'skills'),
    join(homedir(), '.claude', 'skills'),
    join(homedir(), '.codex', 'skills')
  ];
  const before = new Map();
  for (const root of skillRoots) before.set(root, existsSync(root) ? await readdir(root) : []);
  const args = skillsCliArgs(name);
  log(`npx ${args.join(' ')} …`);
  execFileSync('npx', ['--yes', ...args], { cwd: tmp, stdio: 'inherit' });
  const dirs = [];
  for (const root of skillRoots) {
    const prev = before.get(root) || [];
    const after = existsSync(root) ? await readdir(root) : [];
    for (const added of after.filter((x) => !prev.includes(x))) dirs.push(join(root, added));
  }
  const requested = requestedSkillId(name);
  if (!dirs.length && requested) {
    for (const root of skillRoots) {
      const dir = join(root, requested);
      if (existsSync(join(dir, 'SKILL.md'))) dirs.push(dir);
    }
  }
  if (!dirs.length) throw new Error('skills add no dejó un SKILL.md instalable para vendorizar en catalog/skills');
  return { dirs, cleanup: tmp };
}

async function confirmExternalExec({ kind, source, prompter, allowExternalExec }) {
  if (kind === 'local') return;
  const command = kind === 'git' ? 'git clone' : 'npx --yes skills add';
  if (allowExternalExec) return;
  if (!prompter) {
    throw new Error(`${command} ejecuta código/herramientas externas. Reintenta con --allow-exec si confías en la fuente.`);
  }
  const ok = await prompter.yesno(`La fuente "${source}" requiere ejecutar "${command}". ¿Continuar?`, false);
  if (!ok) throw new Error('Instalación cancelada antes de ejecutar herramientas externas.');
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

async function hashDir(dir) {
  const hash = createHash('sha256');
  const walk = async (base) => {
    for (const e of await readdir(base, { withFileTypes: true })) {
      const file = join(base, e.name);
      const rel = relative(dir, file);
      if (rel === '.chalc-skill.json') continue;
      if (e.isDirectory()) await walk(file);
      else {
        hash.update(rel);
        hash.update(await readFile(file));
      }
    }
  };
  await walk(dir);
  return hash.digest('hex');
}

// Devuelve los ids de skills copiados al catálogo.
export async function installSkill({ source, CATALOG, prompter, force = false, allowExternalExec = false, log = () => {} }) {
  const kind = classifySource(source);
  await confirmExternalExec({ kind, source, prompter, allowExternalExec });
  let dirs = [];
  let cleanup = null;
  if (kind === 'git') {
    const r = await gitFetch(source, log);
    dirs = await findSkillDirs(r.dir);
    cleanup = r.cleanup;
  } else if (kind === 'local') {
    dirs = await findSkillDirs(resolve(source));
  } else {
    const r = await skillsShFetch(source, log, CATALOG);
    dirs = r.dirs;
    cleanup = r.cleanup;
  }

  try {
    if (!dirs.length) throw new Error('No encontré ningún SKILL.md en la fuente.');
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
        if (!prompter) throw new Error(`El skill "${id}" ya existe. Usa --force para reemplazarlo.`);
        const replace = await prompter.yesno(`El skill "${id}" ya existe. ¿Reemplazarlo?`, false);
        if (!replace) {
          log(`${id}: se conserva el existente`);
          continue;
        }
      }
      await cp(d, dest, { recursive: true, dereference: true, force: true });
      await writeFile(join(dest, '.chalc-skill.json'), JSON.stringify({
        id,
        source,
        sourceType: kind,
        contentSha256: await hashDir(dest),
        installedAt: new Date().toISOString()
      }, null, 2) + '\n');
      installed.push(id);
    }
    return installed;
  } finally {
    if (cleanup) await rm(cleanup, { recursive: true, force: true }).catch(() => {});
  }
}
