// lib/update.mjs — core de `chalc update` (specs/003-chalc-update): decide qué skills instaladas
// cambiaron en su fuente y aplica el reemplazo. Puro respecto al catálogo que recibe (testeable con
// catálogos y fuentes locales en tmp, sin red); la descarga real la hace lib/install.mjs
// (fetchSkillSource) con sus mismas validaciones de seguridad.

import { cp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { classifySource, fetchSkillSource, hashDir } from './install.mjs';

// Enumera el catálogo: `installed` = skills con manifiesto .chalc-skill.json legible (actualizables);
// `builtins` = sin manifiesto o con manifiesto corrupto (sin fuente conocida: no-actualizables, R9).
// Orden estable por id para que el reporte no baile entre corridas/SO.
export async function listInstalledSkills(catalog) {
  const skillsDir = join(String(catalog || ''), 'skills');
  if (!existsSync(skillsDir)) return { installed: [], builtins: [] };
  const installed = [];
  const builtins = [];
  const entries = (await readdir(skillsDir, { withFileTypes: true })).filter((e) => e.isDirectory());
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const manifestFile = join(skillsDir, e.name, '.chalc-skill.json');
    if (!existsSync(manifestFile)) { builtins.push(e.name); continue; }
    try {
      installed.push({ id: e.name, manifest: JSON.parse(await readFile(manifestFile, 'utf8')) });
    } catch {
      builtins.push(e.name);   // manifiesto roto = fuente desconocida: se cuenta, no se lanza
    }
  }
  return { installed, builtins };
}

// Re-descarga la fuente de UNA skill y compara su hash con el instalado. NUNCA lanza por fallos de
// fuente (R4): devuelve { status: 'fresh' | 'outdated' | 'error' }. En 'outdated' entrega dir +
// cleanup para que el caller aplique y limpie; en los demás casos limpia aquí mismo.
export async function checkSkillUpdate({ id, manifest, log = () => {} } = {}) {
  let cleanup = null;
  try {
    const source = String(manifest?.source || '');
    if (!source) return { status: 'error', reason: 'no-source', error: `manifest without source: ${id}` };
    // Una ruta local BORRADA re-clasificaría como skills.sh y ejecutaría npx sin querer: si el tipo
    // ya no coincide con el instalado, la fuente no está disponible — error claro, cero ejecución.
    if (classifySource(source) !== manifest.sourceType) {
      return { status: 'error', reason: 'source-unavailable', error: source };
    }
    const fetched = await fetchSkillSource(source, { log });
    cleanup = fetched.cleanup;
    const dir = fetched.dirs.find((d) => basename(d) === id);
    if (!dir) return { status: 'error', reason: 'skill-missing', error: `"${id}" not in source anymore` };
    const newHash = await hashDir(dir);
    if (newHash === manifest.contentSha256) return { status: 'fresh' };
    const outdated = { status: 'outdated', newHash, dir, cleanup };
    cleanup = null;   // en 'outdated' la temporal vive hasta que el caller aplique el reemplazo
    return outdated;
  } catch (e) {
    return { status: 'error', reason: 'fetch-failed', error: String(e?.message || e) };
  } finally {
    if (cleanup) await rm(cleanup, { recursive: true, force: true }).catch(() => {});
  }
}

// Orquesta la corrida completa (R1, R5, R6, R7): decide qué skills procesar, respeta --check
// (solo lectura estricta), exige confirmación para fuentes que ejecutan herramientas externas y
// regenera el lock si aplicó cambios. Continúa ante errores por skill (R4). Presentación aparte:
// esto devuelve datos y emite onSkill(resultado) para pintar en vivo; el comando decide los textos.
export async function updateSkills({ catalog, chalcRoot, ids = [], check = false, confirmExternal = null, allowExternalExec = false, log = () => {}, onSkill = () => {} } = {}) {
  const { installed, builtins } = await listInstalledSkills(catalog);
  const byId = new Map(installed.map((s) => [s.id, s]));
  const wanted = ids.length
    ? ids.map((id) => byId.get(id) || { id, missing: true })
    : installed;

  // Confirmación ÚNICA por corrida para las fuentes que ejecutan herramientas externas (git/npx),
  // misma regla que install. El texto lo pone el COMANDO (confirmExternal inyectado, así queda
  // bilingüe); sin permiso, esas skills quedan en error y las locales continúan (R4+R7).
  let externalOk = allowExternalExec;
  const needsExec = wanted.some((s) => !s.missing && s.manifest.sourceType !== 'local');
  if (needsExec && !externalOk && confirmExternal) {
    externalOk = await confirmExternal();
  }

  const results = [];
  let applied = 0;
  for (const s of wanted) {
    let result;
    if (s.missing) {
      result = { id: s.id, status: 'unknown' };
    } else if (s.manifest.sourceType !== 'local' && !externalOk) {
      result = { id: s.id, status: 'error', reason: 'needs-exec' };
    } else {
      const r = await checkSkillUpdate({ id: s.id, manifest: s.manifest, log });
      if (r.status === 'outdated' && !check) {
        await applySkillUpdate({ id: s.id, catalog, dir: r.dir, manifest: s.manifest, newHash: r.newHash });
        if (r.cleanup) await rm(r.cleanup, { recursive: true, force: true }).catch(() => {});
        applied++;
        result = { id: s.id, status: 'updated' };
      } else {
        // en --check la temporal de un outdated también se limpia aquí: nadie va a aplicarla
        if (r.status === 'outdated' && r.cleanup) await rm(r.cleanup, { recursive: true, force: true }).catch(() => {});
        result = { id: s.id, status: r.status, reason: r.reason, error: r.error };
      }
    }
    results.push(result);
    onSkill(result);
  }

  let lockWritten = false;
  if (applied > 0 && chalcRoot) {
    await writeSkillsLock(chalcRoot, catalog);
    lockWritten = true;
  }
  return { results, builtins, lockWritten };
}

// Regenera skills-lock.json COMPLETO desde los manifiestos del catálogo (R8). El lock es un espejo
// para inspección/publicación, nunca fuente de verdad (esa vive junto al contenido vendorizado):
// por eso se reescribe entero y las entradas obsoletas desaparecen solas.
export async function writeSkillsLock(chalcRoot, catalog) {
  const { installed } = await listInstalledSkills(catalog);
  const skills = {};
  for (const { id, manifest } of installed) {
    skills[id] = {
      source: manifest.source,
      sourceType: manifest.sourceType,
      contentSha256: manifest.contentSha256,
      installedAt: manifest.installedAt,
      ...(manifest.updatedAt ? { updatedAt: manifest.updatedAt } : {})
    };
  }
  const file = join(String(chalcRoot), 'skills-lock.json');
  await writeFile(file, JSON.stringify({ version: 1, skills }, null, 2) + '\n');
  return file;
}

// Reemplaza la copia vendorizada con la versión nueva y reescribe el manifiesto (R2). Primero prepara y
// valida una copia hermana; después hace swap por rename. Así un disco lleno/proceso interrumpido nunca
// borra la skill que ya funcionaba y tampoco deja archivos retirados por la fuente.
export async function applySkillUpdate({ id, catalog, dir, manifest, newHash }) {
  const dest = join(String(catalog), 'skills', id);
  const parent = join(String(catalog), 'skills');
  const nonce = randomUUID();
  const staged = join(parent, `.${id}.${nonce}.next`);
  const backup = join(parent, `.${id}.${nonce}.previous`);
  let movedOld = false;
  try {
    await cp(dir, staged, { recursive: true, dereference: true });
    await writeFile(join(staged, '.chalc-skill.json'), JSON.stringify({
      id,
      source: manifest.source,
      sourceType: manifest.sourceType,
      contentSha256: newHash,
      installedAt: manifest.installedAt,          // se conserva cuándo se instaló…
      updatedAt: new Date().toISOString()         // …y se registra cuándo se actualizó
    }, null, 2) + '\n');
    if (!existsSync(join(staged, 'SKILL.md'))) throw new Error(`Actualización inválida: ${id} no tiene SKILL.md`);
    if (await hashDir(staged) !== newHash) throw new Error(`Actualización inválida: hash inesperado para ${id}`);

    if (existsSync(dest)) {
      await rename(dest, backup);
      movedOld = true;
    }
    await rename(staged, dest);
    if (movedOld) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    // Si el segundo rename falla, recuperar la skill anterior es más importante que propagar el error.
    if (movedOld && !existsSync(dest) && existsSync(backup)) {
      try { await rename(backup, dest); } catch { /* el error original conserva el contexto */ }
    }
    throw error;
  } finally {
    await rm(staged, { recursive: true, force: true }).catch(() => {});
    await rm(backup, { recursive: true, force: true }).catch(() => {});
  }
  return dest;
}
