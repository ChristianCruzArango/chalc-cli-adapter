// T8 (spec 018, R5) — `chalc init` deja el repo versionable.
//
// Encontrado en el E2E de la spec 017: `nest new --skip-git` no escribe `.gitignore`, y el primer
// `git add -A` del demo metió 10.487 archivos de `node_modules`. chalc pide `--skip-git` (el repo lo
// decide el usuario), así que el `.gitignore` pasa a ser suyo cuando el scaffolder no lo deja. Si ya
// existe uno, es del scaffolder o del usuario: no se toca.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureGitignore, gitignoreFor } from '../lib/init-gitignore.mjs';
import { reshapeProject } from '../lib/init-scaffold.mjs';
import { buildArchitectureDecision } from '../lib/init.mjs';

const dir = () => mkdtemp(join(tmpdir(), 'chalc-gitignore-'));
const lines = (text) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

test('R5: a project without .gitignore gets one, and the path is returned', async () => {
  const root = await dir();
  assert.equal(await ensureGitignore(root, 'nestjs'), join(root, '.gitignore'));
  assert.ok(existsSync(join(root, '.gitignore')));
});

test('R5: an existing .gitignore is left byte for byte, and nothing is returned', async () => {
  const root = await dir();
  await writeFile(join(root, '.gitignore'), '# mío\nbuild/\n', 'utf8');
  assert.equal(await ensureGitignore(root, 'nestjs'), '');
  assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), '# mío\nbuild/\n');
});

test('R5: every stack ignores secrets but keeps the value-less templates, and the mutation output', () => {
  for (const stack of ['angular', 'nestjs', 'dotnet', 'flutter']) {
    const ignored = lines(gitignoreFor(stack));
    for (const entry of ['.env', '.env.*', '!.env.example', '!.env.sample', '!.env.template', 'reports/mutation/', '.stryker-tmp/', 'StrykerOutput/', 'mutants/']) {
      assert.ok(ignored.includes(entry), `${stack}: ${entry}`);
    }
  }
});

test('R5: each stack ignores its own dependencies and build output', () => {
  for (const [stack, entries] of Object.entries({
    nestjs: ['node_modules/', 'dist/', 'coverage/'],
    angular: ['node_modules/', 'dist/', '.angular/'],
    dotnet: ['bin/', 'obj/', '*.user'],
    flutter: ['build/', '.dart_tool/', '.flutter-plugins', '.flutter-plugins-dependencies']
  })) {
    const ignored = lines(gitignoreFor(stack));
    for (const entry of entries) assert.ok(ignored.includes(entry), `${stack}: ${entry}`);
  }
});

test('R5: an unknown stack still gets the common part', () => {
  const ignored = lines(gitignoreFor('otro'));
  assert.ok(ignored.includes('.env') && ignored.includes('reports/mutation/'));
  assert.ok(!ignored.includes('node_modules/'));
});

test('R5: reshaping a freshly scaffolded project writes the .gitignore', async () => {
  const root = await dir();
  await reshapeProject(root, buildArchitectureDecision({ stack: 'nestjs', proposal: 'API de saludos', architectureId: 'modular-feature' }));
  assert.ok(lines(await readFile(join(root, '.gitignore'), 'utf8')).includes('node_modules/'));
});

// `*.tsbuildinfo` (añadido en el E2E de la spec 018): `npm run build` lo genera en cada corrida del portón,
// que ahora compila, y acababa como cambio sin commitear.
// El `.gitignore` es un dato: se fija entero. Una línea que desaparece en silencio es un archivo que un
// día entra en git sin que nadie lo decidiera.
const COMMON = [
  '# Secretos: nunca en git. Las plantillas sin valores sí.',
  '.env', '.env.*', '!.env.example', '!.env.sample', '!.env.template',
  '',
  '# Salidas de la mutación (el portón las regenera)',
  'reports/mutation/', '.stryker-tmp/', 'StrykerOutput/', 'mutants/',
  '',
  '# Sistema',
  '.DS_Store', 'Thumbs.db',
  ''
].join('\n');

test('R5: the content of each stack is exactly its own part, then the common part', () => {
  const own = {
    nestjs: ['node_modules/', 'dist/', 'coverage/', '*.log', '*.tsbuildinfo'],
    angular: ['node_modules/', 'dist/', '.angular/', 'coverage/', '*.log', '*.tsbuildinfo'],
    dotnet: ['bin/', 'obj/', '*.user', '.vs/', 'TestResults/'],
    flutter: ['build/', '.dart_tool/', '.flutter-plugins', '.flutter-plugins-dependencies', '.packages', 'coverage/']
  };
  for (const [stack, entries] of Object.entries(own)) {
    assert.equal(gitignoreFor(stack), ['# Dependencias y salidas de build', ...entries, '', COMMON].join('\n'), stack);
  }
  assert.equal(gitignoreFor('otro'), COMMON);
});

test('R5: what is written is exactly that content', async () => {
  const root = await dir();
  await ensureGitignore(root, 'dotnet');
  assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), gitignoreFor('dotnet'));
});
