// lib/init-scaffold.mjs — re-moldeo y documentación SOBRE el proyecto que ya creó el scaffolder oficial.
// El scaffold (ng new / nest new / dotnet new) lo corre el bin; aquí solo creamos las carpetas de la
// arquitectura elegida (con .gitkeep para que persistan vacías) y escribimos docs/architecture.md.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { architectureFolders, archText, renderArchitectureDecisionMarkdown } from './init.mjs';
import { renderFolderReadme } from './init-folders.mjs';

// Crea las carpetas de la arquitectura (idempotente) y deja en cada una un README.md que explica, según
// la arquitectura elegida, qué va ahí, buenas prácticas y qué skills aplicar (en vez de un .gitkeep vacío).
export async function applyArchitectureFolders(projectPath, decision) {
  const folders = architectureFolders(decision.stack, decision.architecture?.id);
  const archLabel = archText(decision.architecture?.label);
  for (const rel of folders) {
    const dir = join(projectPath, rel);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'README.md'), renderFolderReadme(decision.stack, archLabel, rel), 'utf8');
  }
  return folders;
}

// Escribe docs/architecture.md con la decisión (principios obligatorios + lectura + arquitectura elegida).
export async function writeArchitectureDoc(projectPath, decision) {
  const path = join(projectPath, 'docs', 'architecture.md');
  await mkdir(join(projectPath, 'docs'), { recursive: true });
  await writeFile(path, renderArchitectureDecisionMarkdown(decision), 'utf8');
  return path;
}

// Re-moldea + documenta el proyecto ya scaffoldeado. Devuelve las carpetas creadas y el doc.
export async function reshapeProject(projectPath, decision) {
  const folders = await applyArchitectureFolders(projectPath, decision);
  const doc = await writeArchitectureDoc(projectPath, decision);
  return { folders, doc };
}
