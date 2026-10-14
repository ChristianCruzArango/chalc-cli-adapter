// T7 (spec 022, R16) — la guarda de secretos cubre lo que dice cubrir: más archivos de credenciales, el
// `Grep` de contenido sobre una carpeta pregunta, y la documentación no promete más de lo que se hace.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from '../catalog/gate/lib/guard-rules.mjs';
import { isSecretFile } from '../catalog/gate/lib/secret-files.mjs';
import { messageOf } from '../catalog/gate/lib/i18n.mjs';

const HOOKS = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'catalog', 'hooks');
const grep = (input) => decide({ tool_name: 'Grep', tool_input: { pattern: 'PASSWORD=', ...input } });

// T7 (spec 022, R16, S8)
test('S8: .envrc, terraform variables, kubeconfig and the docker config are credential files', () => {
  for (const path of ['.envrc', 'infra/prod.tfvars', 'terraform.tfvars.json', 'kubeconfig', '/home/u/.kube/config', '/home/u/.docker/config.json']) {
    assert.equal(isSecretFile(path), true, path);
    assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: path } }).decision, 'deny', path);
  }
  for (const path of ['src/config.json', 'docker/config.json.example', 'kube.ts', 'src/envrc.md']) assert.equal(isSecretFile(path), false, path);
});

// T7 (spec 022, R16, S8)
test('S8: a content Grep over a folder asks, because it can dump lines of a .env it does not name', () => {
  for (const input of [{ path: '.', output_mode: 'content' }, { output_mode: 'content' }, { path: 'src', output_mode: 'content' }, { path: 'src/', output_mode: 'content', glob: '*' }]) {
    const verdict = grep(input);
    assert.deepEqual([verdict.decision, verdict.rule], ['ask', 'secret-grep'], JSON.stringify(input));
  }
});

// T7 (spec 022, R16, S8)
test('S8: a Grep that lists names, targets one file or is narrowed by glob/type still passes', () => {
  for (const input of [{ path: '.' }, { path: '.', output_mode: 'files_with_matches' }, { path: '.', output_mode: 'count' }, { path: 'src/app.ts', output_mode: 'content' }, { path: '.', output_mode: 'content', glob: '*.ts' }, { path: '.', output_mode: 'content', type: 'js' }]) {
    assert.equal(grep(input).decision, 'allow', JSON.stringify(input));
  }
  assert.equal(grep({ path: '.env', output_mode: 'content' }).decision, 'deny');
});

// T7 (spec 022, R16, S8)
test('S8: the reason of the question is written in both languages and names the folder', () => {
  assert.match(messageOf('secret-grep', { path: '.' }, 'es'), /`\.`/);
  assert.match(messageOf('secret-grep', { path: '.' }, 'en'), /`\.`/);
  assert.notEqual(messageOf('secret-grep', { path: '.' }, 'es'), messageOf('secret-grep', { path: '.' }, 'en'));
});

// T7 (spec 022, R16, S8)
test('S8: the hook document says what is really covered: the folder Grep asks, and the limits are named', async () => {
  const es = await readFile(join(HOOKS, 'gate-hook.md'), 'utf8');
  const en = await readFile(join(HOOKS, 'gate-hook.en.md'), 'utf8');
  assert.doesNotMatch(es, /\(`Read`, `Grep`, o cualquier comando que los nombre\)/);
  for (const [doc, asks] of [[es, /output_mode: content.*Te pregunta/], [en, /output_mode: content.*Asks you/]]) {
    assert.match(doc, asks);
    assert.match(doc, /\.envrc/);
    assert.match(doc, /\*\.tfvars/);
    assert.match(doc, /grep -r/);
  }
});
