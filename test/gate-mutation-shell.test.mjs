// S-04 — las rutas que llegan de git son DATOS: nunca se ejecutan ni se parten en dos argumentos.
//
// El comando de la herramienta se lanza con `shell: true` porque lo escribe el humano en
// `gate.json`. Las rutas del alcance, en cambio, salen de una rama o de un PR ajeno: un archivo
// llamado `a$(touch PWNED).ts` no puede ejecutar nada al cerrar la tarea.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shellArg, UnsafeArgError } from '../catalog/gate/lib/run.mjs';
import { runMutation } from '../catalog/gate/lib/mutation.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';

const HOSTILE = ['src/a$(touch PWNED).ts', 'src/my file.ts', "src/it's.ts", 'src/a`id`.ts', 'src/año.ts', 'src/x;rm -rf y.ts'];

test('shellArg leaves plain paths untouched', () => {
  assert.equal(shellArg('src/precio.ts:10-12,src/b.ts', 'linux'), 'src/precio.ts:10-12,src/b.ts');
  assert.equal(shellArg('src/precio.ts', 'win32'), 'src/precio.ts');
});

test('shellArg quotes globs and hostile paths for POSIX shells', () => {
  assert.equal(shellArg('**/X.cs{10..12}', 'linux'), "'**/X.cs{10..12}'");
  assert.equal(shellArg("it's", 'linux'), `'it'\\''s'`);
});

test('shellArg rejects on Windows what cmd.exe expands even inside quotes', () => {
  for (const bad of ['a%PATH%.ts', 'a!x!.ts', 'a".ts', 'a\nb.ts']) {
    assert.throws(() => shellArg(bad, 'win32'), UnsafeArgError);
  }
  assert.equal(shellArg('src/my file.ts', 'win32'), '"src/my file.ts"');
});

test('a POSIX shell receives every hostile path as one literal argument and runs nothing', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-shellarg-'));
  for (const path of HOSTILE) {
    const r = spawnSync(`printf '%s\\n' ${shellArg(path)}`, { cwd: dir, shell: true, encoding: 'utf8' });
    assert.equal(r.stdout, `${path}\n`);
  }
  assert.equal(existsSync(join(dir, 'PWNED')), false);
});

test('runMutation escapes the changed paths instead of pasting them into the command', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-mut-inj-'));
  const calls = [];
  const run = async (command) => {
    calls.push(command);
    await mkdir(join(dir, 'r'), { recursive: true });
    await writeFile(join(dir, 'r/m.json'), JSON.stringify({ files: {} }));
    return { code: 0, ms: 1 };
  };
  const config = { mutation: { command: 'npx stryker run', report: 'r/m.json', format: 'elements', scopeFlag: '--mutate' } };

  await runMutation(config, { root: dir, changed: ['src/a$(touch PWNED).ts', 'src/my file.ts'], run, platform: 'linux' });

  assert.equal(calls[0], "npx stryker run --mutate 'src/a$(touch PWNED).ts,src/my file.ts'");
});

test('runMutation blocks on Windows when a path cannot be quoted for cmd.exe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-mut-win-'));
  let ran = false;
  const config = { mutation: { command: 'dotnet stryker', report: 'r.json', format: 'elements', scopeFlag: '--mutate', scopeJoin: 'repeat' } };

  const r = await runMutation(config, { root: dir, changed: ['src/a%PATH%.cs'], run: async () => { ran = true; return { code: 0, ms: 1 }; }, platform: 'win32' });

  assert.equal(ran, false);
  assert.equal(r.blocked, true);
  assert.equal(r.reason, RULES.unsafePath);
});
