// lib/init-scaffold.mjs — re-moldeo y documentación SOBRE el proyecto que ya creó el scaffolder oficial.
// El scaffold (ng new / nest new / dotnet new) lo corre el bin; aquí solo creamos las carpetas de la
// arquitectura elegida (con .gitkeep para que persistan vacías) y escribimos docs/architecture.md.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { architectureFolders, archText, getStack, renderArchitectureDecisionMarkdown } from './init.mjs';
import { isChalcFolderReadme, renderFolderReadme } from './init-folders.mjs';
import { ensureGitignore } from './init-gitignore.mjs';

// Crea las carpetas de la arquitectura (idempotente) y deja en cada una un README.md que explica, según
// la arquitectura elegida, qué va ahí, buenas prácticas y qué skills aplicar (en vez de un .gitkeep vacío).
export async function applyArchitectureFolders(projectPath, decision) {
  const folders = architectureFolders(decision.stack, decision.architecture?.id);
  const archLabel = archText(decision.architecture?.label, decision.contentLang);
  for (const rel of folders) {
    const dir = join(projectPath, rel);
    await mkdir(dir, { recursive: true });
    const readme = join(dir, 'README.md');
    // Stryker disable next-line StringLiteral: sin codificación, readFile da un Buffer y String() lo lee igual en UTF-8
    if (existsSync(readme) && !isChalcFolderReadme(await readFile(readme, 'utf8'))) continue;
    // Stryker disable next-line StringLiteral: writeFile con codificación '' usa utf8, el mismo resultado
    await writeFile(readme, renderFolderReadme(decision.stack, archLabel, rel, decision.contentLang), 'utf8');
  }
  return folders;
}

// Archivos de arranque del stack (p. ej. el kit de pruebas de React, spec 025 R12). Nunca pisa uno existente.
export async function writeStarterFiles(projectPath, stackId) {
  const written = [];
  for (const [rel, content] of Object.entries(getStack(stackId)?.starterFiles || {})) {
    const path = join(projectPath, rel);
    if (existsSync(path)) continue;
    await mkdir(dirname(path), { recursive: true });
    // Stryker disable next-line StringLiteral: writeFile con codificación '' usa utf8, el mismo resultado
    await writeFile(path, content, 'utf8');
    written.push(rel);
  }
  return written;
}

// Escribe docs/architecture.md con la decisión (principios obligatorios + lectura + arquitectura elegida).
export async function writeArchitectureDoc(projectPath, decision) {
  const path = join(projectPath, 'docs', 'architecture.md');
  await mkdir(join(projectPath, 'docs'), { recursive: true });
  await writeFile(path, renderArchitectureDecisionMarkdown(decision), 'utf8');
  return path;
}

// Re-moldea + documenta el proyecto ya scaffoldeado, y lo deja versionable (spec 018, R5). Devuelve las
// carpetas creadas, el doc y el `.gitignore` escrito ('' si el scaffolder ya dejó uno).
export async function reshapeProject(projectPath, decision) {
  const folders = await applyArchitectureFolders(projectPath, decision);
  const starterFiles = await writeStarterFiles(projectPath, decision.stack);
  const doc = await writeArchitectureDoc(projectPath, decision);
  const gitignore = await ensureGitignore(projectPath, decision.stack);
  return { folders, starterFiles, doc, gitignore };
}
