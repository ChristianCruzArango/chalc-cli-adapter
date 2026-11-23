// specseal.mjs — los sellos de las aprobaciones del usuario (spec 024, R8, R14; spec 028, R2). Responsabilidad
// ÚNICA: leer y escribir `.chalc/seals/<carpeta>.<tipo>.json`. Razón de cambio: qué guarda una aprobación y dónde.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Dos sellos por spec: `spec` (el plan: HU, spec, plan y tareas) y `feature` (el cierre). Uno por spec y por
// tipo: con varias specs a la vez, aprobar una no puede pisar ni validar la de otra. Solo `--approve-spec` y
// `--approve-feature` los escriben. Quien tiene shell puede escribirlos a mano: sube el listón, no es inviolable.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const text = (value) => typeof value === 'string' && value !== '';
const dated = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const matching = (pattern) => (value) => typeof value === 'string' && pattern.test(value);
const fingerprint = matching(/^[0-9a-f]{16}$/);

// Los campos de cada tipo de sello y qué hace válido a cada uno. Lo que no esté aquí no se guarda ni se lee.
const SHAPES = {
  spec: { dir: text, hu: matching(/^[0-9a-f]{64}$/), fingerprint, date: dated },
  // `evidence`: la fecha de la evidencia del portón que se aprobó. `head`: el commit, vacío sin git.
  feature: { dir: text, fingerprint, evidence: dated, head: matching(/^[0-9a-f]*$/), date: dated }
};

const fieldsOf = (seal, kind) => Object.fromEntries(Object.keys(SHAPES[kind]).map((key) => [key, seal[key]]));

/** Ruta del sello `kind` de la carpeta de spec `dir` (p. ej. `specs/002-pagos`). El único sitio que la conoce. */
export const sealPath = (root, dir, kind = 'spec') => join(root, '.chalc', 'seals', `${basename(dir)}.${kind}.json`);

/** El sello `kind` que contiene `raw`, solo con sus campos, o null si no es uno completo y bien formado. */
export function parseSeal(raw, kind = 'spec') {
  let seal;
  try { seal = JSON.parse(raw); } catch { return null; }
  if (!seal || typeof seal !== 'object' || seal.approvedBy !== 'user') return null;
  const valid = Object.entries(SHAPES[kind]).every(([key, check]) => check(seal[key]));
  return valid ? { ...fieldsOf(seal, kind), approvedBy: 'user' } : null;
}

/** El sello `kind` vigente de `dir`, o null: sin archivo, mal formado, o sellado para otra carpeta. */
export async function readSeal(root, dir, kind = 'spec') {
  let raw;
  try { raw = await readFile(sealPath(root, dir, kind), 'utf8'); } catch { return null; }
  const seal = parseSeal(raw, kind);
  return seal && seal.dir === dir ? seal : null;
}

/** Escribe el sello `kind` con los campos de `seal`, a nombre del usuario. Devuelve su ruta. */
export async function writeSeal(root, seal, kind = 'spec') {
  const file = sealPath(root, seal.dir, kind);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ ...fieldsOf(seal, kind), approvedBy: 'user' }, null, 2) + '\n', 'utf8');
  return file;
}
