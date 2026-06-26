import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(ROOT, 'bin/chalc.mjs');

function runChalc(args) {
  return new Promise((resolveRun) => {
    execFile(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolveRun({
        code: error?.code ?? 0,
        stdout,
        stderr,
        output: `${stdout}${stderr}`
      });
    });
  });
}

test('inspect keeps positional path after boolean --yes', async () => {
  const result = await runChalc(['inspect', '--yes', 'test/fixtures/angular']);

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /test\/fixtures\/angular/);
  assert.match(result.output, /Stack detectado: .*Angular/s);
});

test('inspect detects NestJS fixture from package dependencies', async () => {
  const result = await runChalc(['inspect', 'test/fixtures/nestjs', '--yes']);

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /test\/fixtures\/nestjs/);
  assert.match(result.output, /Stack detectado: .*NestJS/s);
});

test('unsafe target ids are rejected before import', async () => {
  const result = await runChalc(['test/fixtures/angular', '--target', '../claude', '--dry-run', '--yes']);

  assert.equal(result.code, 1);
  assert.match(result.output, /target inválido/);
});

test('external install requires explicit execution permission in non-interactive mode', async () => {
  const result = await runChalc(['install', 'https://github.com/example/example', '--yes']);

  assert.equal(result.code, 1);
  assert.match(result.output, /--allow-exec/);
});

test('doctor validates the bundled catalog', async () => {
  const result = await runChalc(['doctor', '--yes']);

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /(sin hallazgos|no findings)/);
});

test('init dry-run summarizes the selected Angular architecture', async () => {
  const result = await runChalc(['init', 'angular', 'demo-admin', '--description', 'Dashboard con usuarios roles permisos formularios y API', '--architecture', 'modular-clean-architecture', '--dry-run', '--yes']);

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /chalc init/);
  assert.match(result.output, /Angular Modular Clean Architecture/);
  assert.match(result.output, /Clean Code, SOLID, (arquitectura modular|modular architecture)/);
});
