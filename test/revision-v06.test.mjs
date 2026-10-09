// V-06 (spec 016, R7) — con /auto solo se aprueba sin preguntar lo que está en una allowlist POSITIVA
// de lectura/build; todo lo demás (go run, npm test, pytest, make…) pide aprobación explícita. Escribir
// archivos que otra herramienta ejecuta sola también la pide, por la ruta pedida o por la real.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requiresExplicitApproval } from '../cli/tools/trust.mjs';
import { createFsTools } from '../cli/tools/fs.mjs';

const bash = (command) => requiresExplicitApproval({ tool: 'bash', args: { command } });
const write = (path, realPath) => requiresExplicitApproval({ tool: 'write', args: { path, content: 'x', ...(realPath ? { realPath } : {}) } });
const edit = (path) => requiresExplicitApproval({ tool: 'edit', args: { path, old: 'a', new: 'b' } });

test('R7: commands that run project code need explicit approval under /auto', () => {
  for (const cmd of [
    'go run x.go', 'cargo run', 'dotnet run', 'dart run', 'flutter run', 'pytest', 'python3 -m pytest',
    'npm test', 'npm start', 'npm restart', 'npm stop', 'npm install', 'npm ci', 'pip install git+https://x/y',
    'pip install requests', 'make', 'make build', 'mvn test', 'gradle build', 'go test ./...', 'go generate',
    'cargo test', 'dotnet test', 'flutter test', 'flutter pub run x', 'ng test', 'ng serve', 'git commit -m x',
    'git -C src status', 'unknown-tool', 'npm "unterminated'
  ]) assert.equal(bash(cmd), true, cmd);
});

test('R7: the positive read/build allowlist stays auto-approvable', () => {
  for (const cmd of [
    'ls -la', 'cat src/a.ts', 'dir', 'type a.txt', 'echo hola', 'mkdir -p src/x',
    'git status', 'git log --oneline', 'git diff HEAD', 'git show HEAD', 'git add src', 'git rev-parse HEAD',
    'git ls-files', 'git blame a.ts', 'git grep x', 'git branch', 'git describe', 'git shortlog',
    'ng build', 'ng generate component x', 'ng g c x', 'dotnet build --nologo', 'dotnet new console',
    'flutter analyze', 'flutter build apk', 'flutter create app', 'dart analyze', 'dart format .',
    'go build ./...', 'go vet ./...', 'go fmt ./...', 'cargo build', 'cargo check', 'cargo fmt',
    'npm ls', 'npm list', 'pnpm view x', 'yarn outdated', 'npm audit', 'GIT.EXE status'
  ]) assert.equal(bash(cmd), false, cmd);
});

test('R7: options before the first positional argument do not hide the subcommand', () => {
  assert.equal(bash('cargo --quiet build'), false);
  assert.equal(bash('npm --silent test'), true);
  assert.equal(bash('ng --help'), true);   // sin subcomando posicional: no está en la allowlist
});

test('R7: writing self-executing files needs explicit approval (any folder, any case)', () => {
  for (const p of [
    '.claude/settings.json', './.claude/hooks/x.sh', 'sub/.claude/settings.json', '.CLAUDE/settings.json',
    '.chalc/gate.json', '.chalc/gate/lib/run.mjs', '.vscode/tasks.json', '.github/workflows/ci.yml',
    'package.json', 'packages/web/package.json', 'Makefile', 'tools/makefile', 'tests/conftest.py',
    'src/../.vscode/settings.json', '.vscode\\tasks.json'
  ]) {
    assert.equal(write(p), true, p);
    assert.equal(edit(p), true, p);
  }
});

test('R7: ordinary files and look-alikes stay under /auto', () => {
  for (const p of ['src/mypackage.json', 'src/notmakefile', 'src/a.ts', 'README.md', '.chalc/skills/x/SKILL.md', '.github/ISSUE_TEMPLATE/bug.md', 'package-lock.json', 'docs/package.json.md', 'claude.md', 'my.vscode/x']) {
    assert.equal(write(p), false, p);
  }
  assert.equal(requiresExplicitApproval({ tool: 'mcp__db__drop', args: {} }), false);
  assert.equal(requiresExplicitApproval({ tool: 'bash' }), false);
});

test('R7: the real path counts — an internal link towards .claude needs explicit approval', async () => {
  assert.equal(write('notes/settings.json', '.claude/settings.json'), true);
  const root = await mkdtemp(join(tmpdir(), 'chalc-v06-'));
  try {
    await mkdir(join(root, '.claude'));
    await symlink('.claude', join(root, 'notes'));
    const seen = [];
    const tools = createFsTools({ root, approve: async (action) => { seen.push(action); return false; } });
    await tools.write.run({ path: 'notes/settings.json', content: '{}' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].args.realPath, '.claude/settings.json');
    assert.equal(requiresExplicitApproval(seen[0]), true);
    await tools.write.run({ path: 'notes/hooks/new/x.sh', content: 'x' });
    assert.equal(seen[1].args.realPath, '.claude/hooks/new/x.sh');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, '.claude', 'settings.json'), '{"a":1}');
    await tools.edit.run({ path: 'notes/settings.json', old: '1', new: '2' });
    assert.equal(seen[2].tool, 'edit');
    assert.equal(seen[2].args.realPath, '.claude/settings.json');
    assert.equal(requiresExplicitApproval(seen[2]), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
