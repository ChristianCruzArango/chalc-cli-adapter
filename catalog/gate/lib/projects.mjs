// projects.mjs — a qué proyecto del repo pertenece un archivo. Responsabilidad ÚNICA: encontrar el
// manifiesto (csproj, package.json, pubspec.yaml…) más cercano por encima de una ruta. Razón de
// cambio: qué archivos marcan la raíz de un proyecto.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Archivos que marcan la raíz de un proyecto dentro del repo.
const MANIFEST = /\.(csproj|fsproj|vbproj)$|^(package\.json|pubspec\.yaml|pom\.xml|build\.gradle(\.kts)?|pyproject\.toml)$/i;

// Proyecto al que pertenece el archivo: su directorio relativo al repo y el nombre de su manifiesto,
// o `null` si no hay ninguno por encima del archivo.
export async function manifestOf(root, rel) {
  const parts = rel.split('/').slice(0, -1);

  // De lo más hondo a lo más somero: manda el proyecto más cercano al archivo.
  for (let i = parts.length; i > 0; i--) {
    const dir = parts.slice(0, i).join('/');
    let entries;
    try {
      entries = await readdir(join(root, dir));
    } catch {
      continue;
    }
    const file = entries.find((e) => MANIFEST.test(e));
    if (file) return { dir, file };
  }
  return null;
}

// Directorio del proyecto al que pertenece el archivo, relativo al repo, o '' si es la raíz.
export async function projectDirOf(root, rel) {
  return (await manifestOf(root, rel))?.dir ?? '';
}
