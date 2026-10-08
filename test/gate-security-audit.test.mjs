// F-20 — los falsos positivos y las evasiones del escáner de seguridad que encontró la auditoría.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSource } from '../catalog/gate/lib/security.mjs';

const rules = (text, file = 'src/a.ts') => scanSource(text, { file }).map((f) => f.rule);

test('no false positive: a header name or a URL in a token-named constant', () => {
  assert.deepEqual(rules('const AUTH_TOKEN_HEADER = "Authorization";'), []);
  assert.deepEqual(rules('const tokenEndpoint = "https://auth.example.com/oauth2/token";'), []);
  assert.deepEqual(rules('const bypass = "Xk9!pQ2zLm";'), []);
});

test('caught: a PASS-named secret, a fallback literal and a URL with credentials', () => {
  assert.deepEqual(rules('const DB_PASS = "Xk9!pQ2zLm";'), ['hardcoded-secret']);
  assert.deepEqual(rules('const secret = process.env.X || "Abcdef12";'), ['hardcoded-secret']);
  assert.deepEqual(rules('const token = process.env.T ?? "Zx9-Qw8-Er7";'), ['hardcoded-secret']);
  assert.deepEqual(rules('password = os.getenv("PW", "Hunter22x")', 'app/x.py'), ['hardcoded-secret']);
  assert.deepEqual(rules('const dbToken = "postgres://admin:s3cr3t@db/app";'), ['hardcoded-secret']);
});

test('caught: child_process exec with a built command, and spawn with shell:true', () => {
  assert.deepEqual(rules('cp.exec(`rm ${dir}`);'), ['dynamic-eval']);
  assert.deepEqual(rules("child.exec('ls ' + dir);"), ['dynamic-eval']);
  assert.deepEqual(rules('spawn(cmd, { shell: true });'), ['dynamic-eval']);
  assert.deepEqual(rules('const m = re.exec(text);'), []);
  assert.deepEqual(rules("spawn('npm', ['test'], { shell: true });"), []);
});

test('caught: sanitize() on one part of a concatenation does not clean the rest', () => {
  assert.deepEqual(rules('el.innerHTML = sanitize(a) + userInput;'), ['unsafe-html']);
  assert.deepEqual(rules('el.innerHTML = DOMPurify.sanitize(html);'), []);
});

test('the secret rules stay linear on long identifiers and long fallback chains', () => {
  const start = Date.now();
  for (const text of ['a'.repeat(100000) + '=', 'x = a ||'.repeat(20000) + '"', 'a=b'.repeat(40000)]) scanSource(text, { file: 'src/a.ts' });
  assert.ok(Date.now() - start < 1500, `${Date.now() - start} ms`);
});
