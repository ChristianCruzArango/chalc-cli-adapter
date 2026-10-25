// lib/install.mjs — instala skills desde Git/GitHub o skills.sh y los vendoriza al catálogo de Chalc.
// "Vendorizar" = copiar el contenido REAL (dereferenciando symlinks) a catalog/skills/<id>,
// para que el skill viaje con Chalc y sea portátil. La descarga vive en lib/skillsource/.

import { cp, readdir, rm, writeFile, lstat } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { join, basename, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertSafeId } from './ids.mjs';
import { t } from './i18n.mjs';
import { within } from './skillsource/within.mjs';
import { hashDir, HASH_VERSION } from './skillsource/hashdir.mjs';
import { gitFetch } from './skillsource/git.mjs';
import { skillsShFetch, SKILLS_CLI } from './skillsource/skillssh.mjs';
import { splitPin } from './skillsource/pin.mjs';
import { assertNoUrlCredentials } from './skillsource/urlcreds.mjs';
import { riskyFrontmatterKeys } from './skillsource/risk.mjs';
import { replaceDir } from './skillsource/swap.mjs';
import { isRunnableTest } from './skillsource/runnabletest.mjs';

// Reexportados: `chalc update`, el lock y los tests los importan desde aquí.
export { hashDir, HASH_VERSION, SKILLS_CLI };

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

// Copia una skill ya validada: sin enlaces que escapen, la copia siguiendo enlaces es segura. Sin los
// archivos que `node --test` ejecutaría (spec 025, R19): la suite de chalc los correría como propios.
export async function copySkillTree(src, dest, opts = {}) {
  await assertNoEscapingLinks(src);
  // Stryker disable next-line StringLiteral: solo cambia algo en Windows (`relative` da `a\\b`); allí lo cubre el test de R19
  const vendored = (path) => !isRunnableTest(relative(src, path).replace(/\\/g, '/'));
  await cp(src, dest, { recursive: true, dereference: true, filter: vendored, ...opts });
}

export function classifySource(s) {
  if (/^(npx\s+)?(add-skill|skills\s+add)\b/.test(s.trim())) return 'skillssh';
  const { base } = splitPin(s);   // `<url>@<commit>`: se clasifica por la URL
  if (/^(https?:\/\/|git@)/.test(base) && /(github\.com|gitlab\.com|bitbucket\.org|\.git)(\/|:|$)/.test(base)) return 'git';
  if (existsSync(resolve(s))) return 'local';
  return 'skillssh';
}

async function confirmExternalExec({ kind, source, prompter, allowExternalExec }) {
  if (kind === 'local') return;
  const command = kind === 'git' ? 'git clone' : `npx --yes ${SKILLS_CLI} add`;
  if (allowExternalExec) return;
  if (!prompter) {
    throw new Error(t('instNeedsExec', command));
  }
  const ok = await prompter.yesno(t('instExecQ', source, command), false);
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

// Descarga/resuelve una fuente y devuelve los dirs con SKILL.md listos para vendorizar.
// Exportado: `chalc update` re-descarga con las MISMAS validaciones de seguridad que install.
// cleanup: carpeta temporal a borrar cuando termines con los dirs (null para fuentes locales).
// `exec` (execFileSync) y `home` son inyectables para los tests: sin red ni HOME real.
export async function fetchSkillSource(source, { log = () => {}, exec = execFileSync, home } = {}) {
  assertNoUrlCredentials(source);
  const kind = classifySource(source);
  if (kind === 'git') {
    const r = await gitFetch(source, { log, exec });
    return { kind, dirs: await findSkillDirs(r.dir), cleanup: r.cleanup, commit: r.commit };
  }
  if (kind === 'local') {
    return { kind, dirs: await findSkillDirs(resolve(source)), cleanup: null };
  }
  const r = await skillsShFetch(source, { log, exec, ...(home ? { home } : {}) });
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

// ¿Se instala `d` como `id`? Sin prompter, un existente exige --force; con prompter, se pregunta. Una skill
// que pide permisos o hooks (S6) se avisa siempre y, con prompter, se confirma.
async function shouldInstall({ d, id, dest, force, prompter, log }) {
  const risky = await riskyFrontmatterKeys(d);
  if (risky.length) {
    log(t('instRiskyFrontmatter', id, risky.join(', ')));
    if (prompter && !await prompter.yesno(t('instRiskyQ', id), false)) return false;
  }
  if (!existsSync(dest) || force) return true;
  if (!prompter) throw new Error(t('instExists', id));
  if (await prompter.yesno(t('instReplaceQ', id), false)) return true;
  log(t('instKeepExisting', id));
  return false;
}

// Devuelve los ids de skills copiados al catálogo. `exec`/`home`: inyectables para tests (ver fetchSkillSource).
export async function installSkill({ source, CATALOG, prompter, force = false, allowExternalExec = false, log = () => {}, exec, home }) {
  // Antes de preguntar, loguear o ejecutar nada: un secreto en la URL no debe salir por ningún lado (S9).
  assertNoUrlCredentials(source);
  const kind = classifySource(source);
  await confirmExternalExec({ kind, source, prompter, allowExternalExec });
  const { dirs, cleanup, commit = '' } = await fetchSkillSource(source, { log, ...(exec ? { exec } : {}), home });

  try {
    if (!dirs.length) throw new Error(t('instNoSkill'));
    let chosen = dirs;
    if (dirs.length > 1 && prompter) {
      const idxs = await prompter.multi(t('instPickMany'), dirs.map((d) => ({ label: basename(d) })), dirs.map((_, i) => i));
      chosen = idxs.map((i) => dirs[i]);
    }
    const installed = [];
    for (const d of chosen) {
      const id = assertSafeId(basename(d), 'skill id');
      const dest = join(CATALOG, 'skills', id);
      if (!await shouldInstall({ d, id, dest, force, prompter, log })) continue;
      // Reemplazo real (F3): copia hermana + rename; lo que la fuente retiró no sobrevive.
      await replaceDir(dest, async (staged) => {
        await copySkillTree(d, staged);
        await writeSkillMeta(staged, { id, source, kind, commit });
      });
      installed.push(id);
    }
    return installed;
  } finally {
    if (cleanup) await rm(cleanup, { recursive: true, force: true }).catch(() => {});
  }
}
