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
  assert.match(result.output, /(Stack detectado|Detected stack): .*Angular/s);
});

test('inspect detects NestJS fixture from package dependencies', async () => {
  const result = await runChalc(['inspect', 'test/fixtures/nestjs', '--yes']);

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /test\/fixtures\/nestjs/);
  assert.match(result.output, /(Stack detectado|Detected stack): .*NestJS/s);
});

test('unsafe target ids are rejected before import', async () => {
  const result = await runChalc(['test/fixtures/angular', '--target', '../claude', '--dry-run', '--yes']);

  assert.equal(result.code, 1);
  assert.match(result.output, /target inválido|Invalid target/);
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
  assert.match(result.output, /(implementación mínima|minimal implementation), Clean Code, SOLID, (arquitectura modular|modular architecture)/);
});

// Spec 025, R17: inspect cuenta lo mismo que el equipamiento instala.
test('inspect shows the React rules an Expo web project does not apply, and why', async () => {
  const result = await runChalc(['inspect', 'test/fixtures/expo-web', '--yes']);

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /react — (incluida en|included in) react-native/);
  assert.match(result.output, /frontend — (incluida en|included in) react-native/);
  assert.doesNotMatch(result.output, /✓ react \(React\)/);
});

// Spec 025, R9, R10, R13: el resumen del init nombra el scaffolder con su versión exacta.
test('init dry-run for react and fastify names the pinned scaffolder and the architecture', async () => {
  const react = await runChalc(['init', 'react', 'demo-web', '--architecture', 'feature-first', '--dry-run', '--yes', '--no-ai']);
  assert.equal(react.code, 0, react.output);
  assert.match(react.output, /create-vite@9\.2\.1/);
  assert.match(react.output, /React Feature-First/);

  const fastify = await runChalc(['init', 'fastify', 'demo-api', '--architecture', 'clean-hexagonal', '--dry-run', '--yes', '--no-ai']);
  assert.equal(fastify.code, 0, fastify.output);
  assert.match(fastify.output, /fastify-cli@7\.4\.1/);
  assert.match(fastify.output, /Fastify Clean \/ Hexagonal/);
});
