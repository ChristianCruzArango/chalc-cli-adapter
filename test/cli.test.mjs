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
  const result = await runChalc(['inspect', '--yes', 'prueba/angular']);

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /prueba\/angular/);
  assert.match(result.output, /Stack detectado: .*Angular/s);
});

test('unsafe target ids are rejected before import', async () => {
  const result = await runChalc(['prueba/angular', '--target', '../claude', '--dry-run', '--yes']);

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
  assert.match(result.output, /sin hallazgos/);
});
