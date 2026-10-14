// lib/skillsource/snapshot.mjs — protege las skills del usuario en ~/.claude/skills y ~/.codex/skills
// mientras corre la CLI de skills.sh, que también instala ahí (F14).
//
// Antes solo se detectaban entradas NUEVAS: una skill del usuario con el mismo id se sobrescribía sin
// aviso. Ahora se toma la huella (hashDir) de cada entrada y una copia de respaldo; tras la CLI, lo
// nuevo o cambiado se lleva a la temporal como descargado y lo cambiado se restaura desde el respaldo.

import { cp, readdir, rm, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashDir } from './hashdir.mjs';

// Huella que no lanza: una entrada ilegible (enlace roto, permisos) se identifica por su lstat.
export async function fingerprint(path) {
  try { return await hashDir(path); } catch {
    try { const st = await lstat(path); return `unreadable:${st.mtimeMs}:${st.size}`; } catch { return 'missing'; }
  }
}

const list = async (root) => (existsSync(root) ? readdir(root) : []);

export async function snapshotRoots(roots, backupDir) {
  const snaps = [];
  for (const [i, root] of roots.entries()) {
    const entries = new Map();
    for (const name of await list(root)) {
      entries.set(name, await fingerprint(join(root, name)));
      await cp(join(root, name), join(backupDir, String(i), name), { recursive: true, verbatimSymlinks: true });
    }
    snaps.push({ root, backup: join(backupDir, String(i)), entries });
  }
  return snaps;
}

// Mueve a `straysDir` lo que la CLI añadió o cambió en las raíces y deja cada raíz como estaba.
// Devuelve las carpetas movidas (candidatas a vendorizar) y los nombres restaurados.
export async function collectChanges(snaps, straysDir) {
  const dirs = [];
  const restored = [];
  for (const [i, { root, backup, entries }] of snaps.entries()) {
    for (const name of await list(root)) {
      const prev = entries.get(name);
      const changed = prev !== undefined && prev !== await fingerprint(join(root, name));
      if (prev !== undefined && !changed) continue;
      const moved = join(straysDir, String(i), name);
      await cp(join(root, name), moved, { recursive: true });
      await rm(join(root, name), { recursive: true, force: true });
      if (changed) {
        await cp(join(backup, name), join(root, name), { recursive: true, verbatimSymlinks: true });
        restored.push(name);
      }
      dirs.push(moved);
    }
  }
  return { dirs, restored };
}
