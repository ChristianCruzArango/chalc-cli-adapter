// V-04 (spec 016, R9) — un archivo de credenciales se redacta por su ruta pedida O por la real (un
// enlace interno `notes.txt -> .env` cuenta como `.env`), y `.netrc` / `.npmrc` se redactan en su
// propio formato. Se observa lo que llega al modelo: la salida de la tool tras `redactStrings`, como
// hace el loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsTools } from '../cli/tools/fs.mjs';
import { createShellTool } from '../cli/tools/shell.mjs';
import { readForPrompt } from '../cli/tools/saferead.mjs';
import { redactStrings, redactSecretFile } from '../lib/redact.mjs';

const FAKE = 'AUDIT_FAKE_PASSWORD_2026';
const IS_WINDOWS = process.platform === 'win32';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'chalc-v04-'));
  await writeFile(join(root, '.env'), `DB_PASSWORD=${FAKE}\nPLAIN=visible\n`);
  await symlink('.env', join(root, 'notes.txt'));
  await writeFile(join(root, '.netrc'), `machine example.invalid login audit password ${FAKE}\nmachine b.invalid\n  login other\n  password ${FAKE}2\n`);
  await writeFile(join(root, '.npmrc'), `registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${FAKE}\n_auth=${FAKE}3\n//r.invalid/:_password=${FAKE}4\n`);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const toModel = (observation) => JSON.stringify(redactStrings(observation));

test('R9: read redacts credentials by the real path, the requested path and in .netrc/.npmrc format', async () => {
  const { root, cleanup } = await fixture();
  try {
    const { read } = createFsTools({ root });
    for (const path of ['.env', 'notes.txt', '.netrc', '.npmrc']) {
      const seen = toModel(await read.run({ path }));
      assert.ok(!seen.includes(FAKE), `${path}: ${seen}`);
    }
    const npmrc = toModel(await read.run({ path: '.npmrc' }));
    assert.ok(npmrc.includes('registry=https://registry.npmjs.org/'));
    const netrc = toModel(await read.run({ path: '.netrc' }));
    assert.ok(netrc.includes('machine example.invalid'));
  } finally { await cleanup(); }
});

test('R9: grep through an internal link to .env does not expose the value', async () => {
  const { root, cleanup } = await fixture();
  try {
    await mkdir(join(root, 'src'));
    await symlink('../.env', join(root, 'src', 'config.txt'));
    const { grep } = createFsTools({ root });
    const seen = toModel(await grep.run({ pattern: 'DB_PASSWORD', path: 'src/config.txt' }));
    assert.ok(seen.includes('src/config.txt'), seen);
    assert.ok(!seen.includes(FAKE), seen);
  } finally { await cleanup(); }
});

test('R9: shell output of a command that names an alias of .env is redacted', { skip: IS_WINDOWS }, async () => {
  const { root, cleanup } = await fixture();
  try {
    const { bash } = createShellTool({ root, allow: ['cat'], approve: async () => true });
    const seen = toModel(await bash.run({ command: 'cat notes.txt' }));
    assert.ok(seen.includes('DB_PASSWORD'), seen);
    assert.ok(!seen.includes(FAKE), seen);
  } finally { await cleanup(); }
});

test('R9: the prompt context reader applies the same format-aware redaction', async () => {
  const { root, cleanup } = await fixture();
  try {
    await symlink('.netrc', join(root, 'hosts.md'));
    assert.ok(!(await readForPrompt(root, join(root, 'hosts.md'))).includes(FAKE));
  } finally { await cleanup(); }
});

test('R9: redactSecretFile keeps the structure and only masks values', () => {
  assert.equal(redactSecretFile('machine h login u password p\n', ['.netrc']), 'machine h login [REDACTED] password [REDACTED]\n');
  assert.equal(redactSecretFile('machine h account a\n', ['x', 'dir/.netrc']), 'machine h account [REDACTED]\n');
  assert.equal(redactSecretFile('//r/:_authToken=abc\n_auth = def\n', ['.npmrc']), '//r/:_authToken=[REDACTED]\n_auth = [REDACTED]\n');
  assert.equal(redactSecretFile('login u password p\n', ['notes.txt']), 'login u password p\n');
  assert.equal(redactSecretFile('_authToken=abc\n', ['.netrc']).includes('abc'), true);
  assert.equal(redactSecretFile('password p\n', ['.npmrc']), 'password p\n');
  assert.equal(redactSecretFile('A_TOKEN=x\n', ['.env.local']), 'A_TOKEN=[REDACTED]\n');
  assert.equal(redactSecretFile('A_TOKEN=x\n', ['notes.txt']), 'A_TOKEN=x\n');
  assert.equal(redactSecretFile('machine h password p\n', ['C:\\Users\\u\\.NETRC']), 'machine h password [REDACTED]\n');
});
