// lib/skillsource/diff.mjs — qué archivos cambian entre la skill instalada y la nueva (S6): lo que
// `chalc update` enseña antes de pedir confirmación por skill.

import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { walkFiles, readNormalized } from './hashdir.mjs';

async function fileHashes(dir) {
  const out = new Map();
  if (!dir || !existsSync(dir)) return out;
  await walkFiles(dir, async (rel, file) => {
    out.set(rel, createHash('sha256').update(await readNormalized(file)).digest('hex'));
  });
  return out;
}

// { added, removed, modified }: rutas relativas con `/`, ordenadas.
export async function diffSkillDirs(oldDir, newDir) {
  const before = await fileHashes(oldDir);
  const after = await fileHashes(newDir);
  const added = [...after.keys()].filter((f) => !before.has(f));
  const removed = [...before.keys()].filter((f) => !after.has(f));
  const modified = [...after.keys()].filter((f) => before.has(f) && before.get(f) !== after.get(f));
  return { added, removed, modified };
}
