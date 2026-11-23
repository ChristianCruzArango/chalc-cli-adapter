// Spec 029 (hooks, integridad y CI), T4 — equipar deja los hooks de git y los activa (R1, R2, R3). Corren con
// cualquier asistente, y también cuando commitea una persona. Los hooks propios del proyecto no se pisan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { HOOKS_PATH, emitGitHooks } from '../lib/githooks.mjs';
import { equipForSpec } from '../lib/commands/equip.mjs';
import { integrityProblems } from '../catalog/gate/lib/integrity.mjs';
import { toolingDrift } from '../lib/tooldrift.mjs';
import { DICT, t as tr } from '../lib/i18n.mjs';

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const hooksPath = (dir) => git(['config', '--local', '--get', 'core.hooksPath'], dir).stdout.trim();
async function repo(t, { init = true } = {}) {
  const dir = await tempDir(t, 'chalc-029-githooks-');
  if (init) assert.equal(git(['init', '-q'], dir).status, 0);
  return dir;
}

test('R1: en un repo de git deja pre-commit y pre-push y fija core.hooksPath', async (t) => {
  const dir = await repo(t);
  const out = await emitGitHooks(dir);
  assert.equal(HOOKS_PATH, '.chalc/hooks');
  assert.equal(out.status, 'installed');
  assert.deepEqual(out.written, ['.chalc/hooks/pre-commit', '.chalc/hooks/pre-push']);
  assert.equal(hooksPath(dir), '.chalc/hooks');
  for (const name of ['pre-commit', 'pre-push']) {
    const text = await readFile(join(dir, '.chalc', 'hooks', name), 'utf8');
    assert.match(text, /^#!\/bin\/sh\n/);
    assert.ok(text.includes(`exec node .chalc/gate.mjs --hook ${name}`), name);
    assert.equal(text.includes('\r'), false, 'fin de línea de Unix: es un script de sh');
  }
});

test('R1: los hooks quedan ejecutables', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await repo(t);
  await emitGitHooks(dir);
  for (const name of ['pre-commit', 'pre-push']) assert.ok(statSync(join(dir, '.chalc', 'hooks', name)).mode & 0o111, name);
});

test('R1: equipar otra vez no cambia nada', async (t) => {
  const dir = await repo(t);
  await emitGitHooks(dir);
  assert.equal((await emitGitHooks(dir)).status, 'unchanged');
  assert.equal(hooksPath(dir), '.chalc/hooks');
});

test('R2: si el proyecto ya tiene su carpeta de hooks, no se pisa y se dice cuál es', async (t) => {
  const dir = await repo(t);
  git(['config', '--local', 'core.hooksPath', '.husky'], dir);
  const out = await emitGitHooks(dir);
  assert.deepEqual([out.status, out.other], ['kept-other', '.husky']);
  assert.equal(hooksPath(dir), '.husky');
  assert.ok(existsSync(join(dir, '.chalc', 'hooks', 'pre-commit')), 'los archivos quedan igualmente');
});

test('R3: fuera de un repo de git deja los archivos y no falla', async (t) => {
  const dir = await repo(t, { init: false });
  const out = await emitGitHooks(dir);
  assert.equal(out.status, 'no-git');
  assert.ok(existsSync(join(dir, '.chalc', 'hooks', 'pre-push')));
});

test('R3: en una subcarpeta de un repo no fija core.hooksPath (la ruta no valdría desde la raíz)', async (t) => {
  const root = await repo(t);
  const sub = join(root, 'apps', 'web');
  await mkdir(sub, { recursive: true });
  const out = await emitGitHooks(sub);
  assert.equal(out.status, 'not-root');
  assert.equal(hooksPath(root), '');
});

test('R1: equipar un proyecto instala los hooks y entran en la integridad y en la comparación con el catálogo', async (t) => {
  const dir = await repo(t);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  assert.equal(hooksPath(dir), '.chalc/hooks');
  const manifest = JSON.parse(await readFile(join(dir, '.chalc', 'integrity.json'), 'utf8'));
  assert.ok('.chalc/hooks/pre-commit' in manifest.files);
  assert.deepEqual(await integrityProblems(dir), []);
  assert.deepEqual(await toolingDrift(dir), []);
  await writeFile(join(dir, '.chalc', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
  assert.deepEqual(await toolingDrift(dir), ['.chalc/hooks/pre-commit']);
});

test('los avisos de cada resultado existen en es y en', () => {
  for (const lang of ['es', 'en']) {
    for (const key of ['gitHooksInstalled', 'gitHooksKeptOther', 'gitHooksNoGit', 'gitHooksNotRoot']) assert.ok(DICT[lang][key], `${lang}.${key}`);
  }
  assert.match(DICT.es.gitHooksKeptOther('.husky'), /\.husky/);
  assert.match(DICT.es.gitHooksKeptOther('.husky'), /node \.chalc\/gate\.mjs --hook pre-commit/);
});

// Lo que equipar le DICE al usuario sobre los hooks (R1–R3): una línea por resultado, y ninguna si no cambió nada.
async function equipSaying(dir) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' }); } finally { console.log = original; }
  return lines.filter((line) => /hook/i.test(line));
}
const pkg = (dir) => writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
const said = (key, other) => [`  ${tr(key, other)}`];

test('R1: equipar avisa de que instaló los hooks, y al repetir ya no dice nada', async (t) => {
  const dir = await repo(t);
  await pkg(dir);
  assert.deepEqual((await equipSaying(dir)).map((line) => line.replace(/\u001b\[\d+m/g, '')), said('gitHooksInstalled', ''));
  assert.deepEqual(await equipSaying(dir), [], 'sin cambios no hay aviso');
});

test('R2, R3: equipar avisa cuando los hooks NO quedan activos: otra carpeta, sin git o en una subcarpeta', async (t) => {
  const plain = (lines) => lines.map((line) => line.replace(/\u001b\[\d+m/g, ''));
  const other = await repo(t);
  await pkg(other);
  git(['config', '--local', 'core.hooksPath', '.husky'], other);
  assert.deepEqual(plain(await equipSaying(other)), said('gitHooksKeptOther', '.husky'));
  const noGit = await repo(t, { init: false });
  await pkg(noGit);
  assert.deepEqual(plain(await equipSaying(noGit)), said('gitHooksNoGit', ''));
  const root = await repo(t);
  const sub = join(root, 'apps', 'web');
  await mkdir(sub, { recursive: true });
  await pkg(sub);
  assert.deepEqual(plain(await equipSaying(sub)), said('gitHooksNotRoot', ''));
});
