// lib/init-gitignore.mjs — el `.gitignore` de un proyecto recién creado (spec 018, R5). Responsabilidad
// ÚNICA: dejar el repo versionable cuando el scaffolder no lo hizo. Razón de cambio: qué genera cada stack
// que no debe entrar en git.
//
// Por qué existe: chalc pide `--skip-git` a los scaffolders (el repositorio lo decide el usuario), y con
// esa opción `nest new` —y `dotnet new`— no escriben `.gitignore`. En el E2E de la spec 017, el primer
// `git add -A` metió 10.487 archivos de `node_modules`. Si el scaffolder sí lo escribió, o el usuario ya
// tiene uno, es suyo y no se toca.

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Lo que ningún stack quiere en git: secretos (pero sí sus plantillas sin valores, que documentan qué
// variables hacen falta), lo que generan el portón y sus herramientas de mutación, y lo efímero del
// tablero en vivo (spec 020).
const COMMON = [
  '# Secretos: nunca en git. Las plantillas sin valores sí.',
  '.env', '.env.*', '!.env.example', '!.env.sample', '!.env.template',
  '',
  '# Salidas de la mutación (el portón las regenera)',
  'reports/mutation/', '.stryker-tmp/', 'StrykerOutput/', 'mutants/',
  '',
  '# Tablero en vivo: su anuncio (puerto y pid), la actividad y los tokens de la sesión',
  '.chalc/live.json', '.chalc/activity.jsonl', '.chalc/usage.json',
  '',
  '# Sistema',
  '.DS_Store', 'Thumbs.db'
];

// `*.tsbuildinfo`: lo genera la compilación incremental de TypeScript, y el portón compila en cada corrida.
const BY_STACK = {
  nestjs: ['node_modules/', 'dist/', 'coverage/', '*.log', '*.tsbuildinfo'],
  angular: ['node_modules/', 'dist/', '.angular/', 'coverage/', '*.log', '*.tsbuildinfo'],
  dotnet: ['bin/', 'obj/', '*.user', '.vs/', 'TestResults/'],
  flutter: ['build/', '.dart_tool/', '.flutter-plugins', '.flutter-plugins-dependencies', '.packages', 'coverage/']
};

/** El contenido del `.gitignore` de un stack: lo suyo y lo común. Un stack desconocido recibe lo común. */
export function gitignoreFor(stackId) {
  const own = BY_STACK[stackId] || [];
  return [...(own.length ? ['# Dependencias y salidas de build', ...own, ''] : []), ...COMMON, ''].join('\n');
}

/** Escribe el `.gitignore` si el proyecto no tiene uno. Devuelve su ruta, o '' si ya existía. */
export async function ensureGitignore(projectPath, stackId) {
  const path = join(projectPath, '.gitignore');
  if (existsSync(path)) return '';
  await writeFile(path, gitignoreFor(stackId), 'utf8');
  return path;
}
