// sharedroot.mjs — de qué carpeta es la memoria (spec 036, R1). Responsabilidad ÚNICA: resolver el almacén único
// del proyecto. Razón de cambio: dónde vive la memoria cuando hay worktrees.
//
// Este archivo lo emite chalc dentro de `.chalc/memory/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Cada spec se trabaja en su worktree, pero la memoria es UNA: lo que aprende un desarrollador lo leen los
// demás al momento, sin esperar a que alguien una ramas. Por eso, desde un worktree, se escribe en el repo principal.

import { mainRoot } from '../../team/lib/root.mjs';

// Una consulta a git por carpeta y proceso: la respuesta no cambia mientras corre el comando.
const known = new Map();

/** La carpeta cuya memoria usa `root`: la misma, o su equivalente en el repo principal si `root` es un worktree. */
export function sharedRoot(root) {
  if (!known.has(root)) known.set(root, mainRoot(root));
  return known.get(root);
}
