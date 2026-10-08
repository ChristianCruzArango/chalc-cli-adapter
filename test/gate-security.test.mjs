// spec 014 — la etapa `security` del portón, regla por regla.
//
// Cada regla se prueba en las dos direcciones: lo que TIENE que disparar y lo que no. La segunda
// mitad es la que mantiene viva la etapa: un detector de seguridad con falsos positivos se silencia
// a base de `chalc-allow` hasta que nadie lee lo que dice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { blankOut } from '../catalog/gate/lib/source.mjs';
import { scanSource, securityLines } from '../catalog/gate/lib/security.mjs';

// ── T2 (R10, R15): qué texto se mira ──────────────────────────────────────────────────────────

// Los secretos y las URLs viven DENTRO de los literales, así que esta etapa no puede vaciarlos como
// hace `smells`. Pero el `//` de `http://` tampoco puede leerse como el inicio de un comentario: la
// URL desaparecería justo donde hay que verla.
test('R10: keeping literals does not mistake the slashes of a URL for a comment', async () => {
  const text = 'const u = "http://api.example.com/v1"; // eval(x)\n';
  const clean = blankOut(text, { lineComment: '//', block: true, template: true, strings: false });

  assert.match(clean, /http:\/\/api\.example\.com\/v1/);
  assert.doesNotMatch(clean, /eval/);
});

test('R10: the security view keeps literal content and drops comments', async () => {
  const text = [
    'const key = "sk_live_1234567890";',
    '// const old = "http://legacy.example.com";',
    '/* eval(input) */',
    'const x = 1;'
  ].join('\n');

  const lines = securityLines(text, 'src/pago.ts');

  assert.match(lines[0], /sk_live_1234567890/);
  assert.doesNotMatch(lines[1], /legacy/);
  assert.doesNotMatch(lines[2], /eval/);
  assert.equal(lines.length, 4, 'las posiciones no se mueven');
});

test('R10: python comments are dropped with their own marker', async () => {
  const lines = securityLines('url = "http://x.example.com"  # verify=False\n', 'app/api.py');

  assert.match(lines[0], /http:\/\/x\.example\.com/);
  assert.doesNotMatch(lines[0], /verify/);
});

// Sin dialecto no hay lectura fiable, y una lectura inventada produce hallazgos falsos.
test('R15: a language with no security dialect yields nothing', async () => {
  const text = 'password = "supersecret123"\nurl = "http://example.com"\n';

  assert.equal(securityLines(text, 'config/app.rb'), null);
  assert.deepEqual(scanSource(text, { file: 'config/app.rb' }), []);
  assert.deepEqual(scanSource(text, { file: 'README.md' }), []);
});

test('R15: every language the gate reads has a security dialect', async () => {
  for (const file of ['a.ts', 'a.tsx', 'a.js', 'a.mjs', 'a.dart', 'a.cs', 'a.java', 'a.kt', 'a.py']) {
    assert.ok(Array.isArray(securityLines('x\n', file)), file);
  }
});

test('R15: clean code yields no security findings', async () => {
  const text = 'export const total = (a: number, b: number) => a + b;\n';
  assert.deepEqual(scanSource(text, { file: 'src/total.ts' }), []);
});

