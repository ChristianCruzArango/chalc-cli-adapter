// T5 (spec 017, R3) — la guarda no deja al asistente leer archivos de credenciales.
//
// Un `.env` o una llave SSH leídos por el asistente acaban en el contexto del modelo, y de ahí en un
// resumen, un commit o un log. La redacción de chalc protege SU shell; con Claude Code al volante no
// había nada. La definición de «archivo de credenciales» es la misma que usa la redacción (T2, R6), y
// las plantillas sin valores (`.env.example`, `.env.sample`, `.env.template`) quedan fuera.
//
// Qué se mira de cada herramienta:
//   - Read / NotebookRead: el archivo que leen.
//   - Grep: la ruta y el filtro `glob` (los dos deciden qué CONTENIDO se lee). El `pattern` es el texto
//     buscado, no una ruta: buscar «.env» dentro de `src/` es legítimo.
//   - Glob: solo la ruta base. Su patrón lista nombres, no lee contenido.
//   - Bash: cada palabra de cada comando simple, el valor de `--opcion=ruta` y los comodines simples.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/gate/lib/guard-rules.mjs';

const tool = (tool_name, tool_input) => ({ tool_name, tool_input });
const bash = (command) => tool('Bash', { command });
const ALLOW = { decision: 'allow', rule: '', data: {} };

test('R3: reading a credential file is denied and names the file', () => {
  assert.deepEqual(decide(tool('Read', { file_path: '.env' })), { decision: 'deny', rule: 'secret-read', data: { path: '.env' } });
  assert.equal(decide(tool('Read', { file_path: '/home/u/app/.env.local' })).decision, 'deny');
  assert.equal(decide(tool('Read', { file_path: '/home/u/.ssh/id_ed25519' })).decision, 'deny');
  assert.equal(decide(tool('NotebookRead', { notebook_path: 'secrets.json' })).decision, 'deny');
});

test('R3: reading an ordinary file or an env template is allowed', () => {
  for (const file_path of ['src/app.ts', '.env.example', 'apps/api/.env.sample', '.env.template', 'src/env.ts']) {
    assert.deepEqual(decide(tool('Read', { file_path })), ALLOW, file_path);
  }
});

test('R3: grep over a credential file, or filtered to one, is denied', () => {
  assert.deepEqual(decide(tool('Grep', { pattern: 'KEY', path: '.env' })), { decision: 'deny', rule: 'secret-read', data: { path: '.env' } });
  assert.deepEqual(decide(tool('Grep', { pattern: 'KEY', glob: '.env*' })), { decision: 'deny', rule: 'secret-read', data: { path: '.env*' } });
});

test('R3: the text grep looks for is not a path', () => {
  assert.deepEqual(decide(tool('Grep', { pattern: '.env', path: 'src' })), ALLOW);
});

test('R3: glob only lists names: its pattern is not read, its base path is', () => {
  assert.deepEqual(decide(tool('Glob', { pattern: '**/.env' })), ALLOW);
  assert.equal(decide(tool('Glob', { pattern: '*', path: 'config/credentials' })).decision, 'deny');
});

test('R3: tools that do not read are not checked here', () => {
  assert.deepEqual(decide(tool('Write', { file_path: 'notes.md', content: 'see .env' })), ALLOW);
  assert.deepEqual(decide(tool('Read', { file_path: 42 })), ALLOW);
  assert.deepEqual(decide(tool('Read')), ALLOW);
});

test('R3: a shell command that names a credential file is denied', () => {
  for (const [command, path] of [
    ['cat .env', '.env'],
    ['cp .env /tmp/x', '.env'],
    ['git add .env', '.env'],
    ['source ./.env.local', './.env.local'],
    ['cat ~/.ssh/id_rsa', '~/.ssh/id_rsa'],
    ['echo $HOME/.netrc', '$HOME/.netrc'],
    ['base64<.npmrc', '.npmrc'],
    ['npm test && cat .pypirc', '.pypirc']
  ]) {
    assert.deepEqual(decide(bash(command)), { decision: 'deny', rule: 'secret-read', data: { path } }, command);
  }
});

test('R3: the value of an option and a simple wildcard are read as paths', () => {
  assert.deepEqual(decide(bash('docker run --env-file=.env img')).data, { path: '--env-file=.env' });
  assert.equal(decide(bash('cat .env*')).decision, 'deny');
  assert.equal(decide(bash('cat certs/*.pem')).decision, 'deny');
});

test('R3: shell commands with ordinary files or templates are allowed', () => {
  for (const command of ['cat .env.example', 'ls -la', 'npm run env', 'cat src/env.ts', 'grep -r token src', 'cat *.ts']) {
    assert.deepEqual(decide(bash(command)), ALLOW, command);
  }
});

test('R3: a credential file outranks a question in the same chain', () => {
  assert.equal(decide(bash('git commit -m x && cat .env')).rule, 'secret-read');
});
