// S-17 — redacción de secretos: los casos que se escapaban, los que no deben tocarse y su coste.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactSensitiveText, redactKnownSecrets, isSecretFile } from '../lib/redact.mjs';
import { childEnv } from '../lib/childenv.mjs';
import { createFsTools } from '../cli/tools/fs.mjs';
import { createShellTool } from '../cli/tools/shell.mjs';
import { runAgent } from '../cli/engine/loop.mjs';

test('quoted values with spaces or escaped quotes are fully redacted', () => {
  assert.equal(redactSensitiveText('{"password": "correct horse battery"}'), '{"password": "[REDACTED]"}');
  assert.equal(redactSensitiveText('{"apiKey":"abc\\"def"}'), '{"apiKey":"[REDACTED]"}');
  assert.equal(redactSensitiveText("secret='a b c'"), "secret='[REDACTED]'");
});

test('cookies, passwd, pass and compound names are redacted', () => {
  assert.equal(redactSensitiveText('Cookie: sessionid=abc123; csrftoken=x'), 'Cookie: [REDACTED]');
  assert.equal(redactSensitiveText('Set-Cookie: sid=abc; HttpOnly'), 'Set-Cookie: [REDACTED]');
  assert.equal(redactSensitiveText('passwd=hunter2'), 'passwd=[REDACTED]');
  assert.equal(redactSensitiveText('pass=xyz&user=1'), 'pass=[REDACTED]&user=1');
  assert.equal(redactSensitiveText('DB_PASS="Xk9!pQ2zLm"'), 'DB_PASS="[REDACTED]"');
  assert.equal(redactSensitiveText('stripeSecret: sk_live_x'), 'stripeSecret: [REDACTED]');
});

test('words that only contain a sensitive word are left alone', () => {
  for (const text of ['bypass=true', 'passport=AB123', 'compass: north', 'tokenizer=simple']) {
    assert.equal(redactSensitiveText(text), text);
  }
});

test('the strict level never rewrites ordinary code', () => {
  const code = 'const token = getToken();\nfetch(u, { headers: { Authorization: "Bearer " + token } }); // Basic auth\nconst password = form.password;';
  assert.equal(redactKnownSecrets(code), code);
});

test('the strict level removes unmistakable secrets', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
  const out = redactKnownSecrets(`k=${jwt} sk-ant-abcdefghijklmnop https://u:p4ss@h.com Bearer abcdefghijklmnopqrstuvwxyz\n-----BEGIN EC PRIVATE KEY-----\nMHc\n-----END EC PRIVATE KEY-----`);
  for (const leaked of [jwt, 'sk-ant-abc', 'u:p4ss', 'abcdefghijklmnopqrstuvwxyz', 'MHc']) assert.equal(out.includes(leaked), false, leaked);
});

test('redaction stays linear on crafted input', () => {
  const start = Date.now();
  for (const s of ['-----BEGIN PRIVATE KEY-----'.repeat(9000), 'a.'.repeat(130000), 'x="'.repeat(85000), 'a_'.repeat(150000)]) redactSensitiveText(s);
  assert.ok(Date.now() - start < 1500);
});

test('secret files are recognised by name', () => {
  for (const f of ['.env', '.env.local', 'config/.env.production', 'id_rsa', 'certs/server.key', '.npmrc', 'secrets.yaml']) assert.equal(isSecretFile(f), true, f);
  for (const f of ['src/env.ts', 'environment.ts', 'keys.md', 'README.md']) assert.equal(isSecretFile(f), false, f);
});

test('read, grep and bash do not hand the model the values of a .env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-s17-'));
  await writeFile(join(root, '.env'), 'DB_HOST=localhost\nDB_PASSWORD=Sup3rS3cret\nAPI_KEY="k k k"\n');
  const { read, grep } = createFsTools({ root });
  const { bash } = createShellTool({ root, allow: ['cat'], approve: async () => true });
  const seen = [(await read.run({ path: '.env' })).content, JSON.stringify(await grep.run({ pattern: 'DB_', path: '.env' }))];
  if (process.platform !== 'win32') seen.push((await bash.run({ command: 'cat .env' })).stdout);
  for (const text of seen) {
    assert.equal(text.includes('Sup3rS3cret'), false);
    assert.equal(text.includes('k k k'), false);
    assert.match(text, /DB_HOST=localhost/);
  }
});

test('every observation that reaches the model goes through the strict level', async () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
  const tools = { leak: { summary: 'x', run: async () => ({ text: `token found: ${jwt}` }) } };
  let call = 0;
  const chatImpl = async () => (call++ === 0
    ? JSON.stringify({ thought: 't', action: { tool: 'leak', args: {} } })
    : JSON.stringify({ thought: 't', done: true, summary: 'ok' }));
  const r = await runAgent({ tools, chatImpl, renderPrompt: () => ({ system: '', user: '' }), maxSteps: 3, ccr: false });
  assert.equal(JSON.stringify(r.steps).includes(jwt), false);
});

test('child processes do not inherit the user credentials', () => {
  const env = childEnv({ CI: 'true' }, { PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b', CHALC_PAT: 'c', GITHUB_TOKEN: 'd', AWS_SECRET_ACCESS_KEY: 'e', DB_PASSWORD: 'f', SSH_AUTH_SOCK: '/s', GIT_ASKPASS: 'g', CHALC_PASS_ENV: 'GITHUB_TOKEN' });
  assert.deepEqual(Object.keys(env).sort(), ['CI', 'GITHUB_TOKEN', 'GIT_ASKPASS', 'HOME', 'PATH', 'SSH_AUTH_SOCK']);
});
