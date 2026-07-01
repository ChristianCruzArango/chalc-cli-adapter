// lib/specfolder.mjs — resolución de carpetas de spec: numeración, idempotencia por slug y
// anti-drift del contrato. Responsabilidad única: decidir DÓNDE va cada spec y dejar constancia
// de CON QUÉ contrato se generó, para que re-generar la misma HU no cree carpetas duplicadas
// (NNN+1 cada vez) ni deje spec/plan/tasks desincronizados del contrato del que salieron.

import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

// Slug de una carpeta 'NNN-mi-slug' → 'mi-slug'. null si no matchea el patrón NNN-.
export function folderSlug(name) {
  const m = String(name).match(/^(\d{1,4})-(.+)$/);
  return m ? m[2] : null;
}

// Nombres de subcarpetas de specsDir (vacío si el directorio no existe todavía).
async function specDirs(specsDir) {
  if (!existsSync(specsDir)) return [];
  return (await readdir(specsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
}

// Siguiente número (max+1, 3 dígitos) a partir de las carpetas NNN- existentes.
export async function nextNumber(specsDir) {
  const dirs = await specDirs(specsDir);
  const max = dirs.reduce((n, name) => {
    const m = name.match(/^(\d{1,4})-/);
    return m ? Math.max(n, parseInt(m[1], 10)) : n;
  }, 0);
  return String(max + 1).padStart(3, '0');
}

// Carpeta existente 'NNN-slug' para un slug dado (idempotencia), o null si no hay ninguna.
export async function findBySlug(specsDir, slug) {
  const dirs = await specDirs(specsDir);
  return dirs.find((name) => folderSlug(name) === slug) || null;
}

// Resuelve la carpeta destino para (specsDir, slug): REÚSA la del mismo slug si ya existe
// (idempotente: re-generar actualiza en sitio, no crea duplicados) o crea una nueva.
// preferredNum fuerza el número al crear (para alinear el mismo NNN entre repos).
export async function resolveFeatureFolder(specsDir, slug, preferredNum = null) {
  const existing = await findBySlug(specsDir, slug);
  if (existing) return { name: existing, reused: true };
  const num = preferredNum || await nextNumber(specsDir);
  return { name: `${num}-${slug}`, reused: false };
}

// Número compartido para una feature NUEVA entre varios repos: el mayor de los "siguientes",
// para que front y back arranquen con el MISMO NNN. Si un repo ya tiene el slug, resolveFeatureFolder
// respeta su carpeta (este número solo se usa al crear de cero).
export async function sharedNumber(specsDirs) {
  const nums = await Promise.all(specsDirs.map(nextNumber));
  return String(Math.max(...nums.map((n) => parseInt(n, 10)))).padStart(3, '0');
}

// Huella corta y estable del contrato: mismo contenido → misma huella. Sirve para detectar drift.
export function contractFingerprint(contract) {
  return createHash('sha256').update(String(contract ?? '')).digest('hex').slice(0, 12);
}

// Sello invisible (comentario HTML, no se ve en el markdown renderizado) que estampa la huella
// del contrato en cada spec generada. Permite auditar si una spec quedó atada a un contrato viejo.
export function contractStamp(fingerprint, iso) {
  return `<!-- chalc:contract fingerprint=${fingerprint} generated=${iso} -->`;
}

// Antepone el sello del contrato a cada archivo generado (spec/plan/tasks).
export function stampFiles(files, stamp) {
  const out = {};
  for (const [name, content] of Object.entries(files)) out[name] = stamp + '\n' + String(content);
  return out;
}

// Lee el lock del contrato de una carpeta de feature (o null si no existe / está corrupto).
export async function readContractLock(featureDir) {
  try {
    return JSON.parse(await readFile(join(featureDir, '.chalc', 'contract.lock.json'), 'utf8'));
  } catch { return null; }
}

// Escribe el lock del contrato JUNTO a la spec, así el par (spec, contrato) queda trazado.
export async function writeContractLock(featureDir, lock) {
  const file = join(featureDir, '.chalc', 'contract.lock.json');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  return file;
}
