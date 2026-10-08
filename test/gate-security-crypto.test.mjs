// spec 014 — etapa `security` del portón: hashes débiles.
//
// Cada regla se prueba en las dos direcciones: lo que TIENE que disparar y lo que no. La segunda
// mitad es la que mantiene viva la etapa: un detector con falsos positivos se silencia a base de
// `chalc-allow` hasta que nadie lee lo que dice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSource } from '../catalog/gate/lib/security.mjs';

const rulesIn = (text, file) => scanSource(text, { file }).map((f) => f.rule);

// ── T9 (R8): weak-hash ────────────────────────────────────────────────────────────────────────

const hashIn = (text, file) => scanSource(text, { file }).filter((f) => f.rule === 'weak-hash');

test('R8: MD5 and SHA1 fire and name the algorithm, in every stack', async () => {
  const cases = [
    ["const h = createHash('md5').update(pass).digest('hex');", 'src/auth.ts', 'md5'],
    ['const h = crypto.createHash("sha1");', 'src/auth.js', 'sha1'],
    ['final digest = md5.convert(utf8.encode(pin));', 'lib/auth/pin.dart', 'md5'],
    ['final digest = sha1.convert(bytes);', 'lib/auth/pin.dart', 'sha1'],
    ['h = hashlib.md5(password.encode()).hexdigest()', 'app/auth.py', 'md5'],
    ["h = hashlib.new('sha1', data)", 'app/auth.py', 'sha1'],
    ['MessageDigest md = MessageDigest.getInstance("MD5");', 'src/Auth.java', 'md5'],
    ['val md = MessageDigest.getInstance("SHA-1")', 'src/Auth.kt', 'sha1'],
    ['using var md5 = MD5.Create();', 'src/Auth.cs', 'md5'],
    ['var sha = new SHA1Managed();', 'src/Auth.cs', 'sha1']
  ];
  for (const [text, file, algo] of cases) {
    const found = hashIn(text, file);
    assert.equal(found.length, 1, `${file}: ${text}`);
    assert.equal(found[0].data.match, algo, `${file}: ${text}`);
  }
});

test('R8: strong hashes and look-alike names do not fire', async () => {
  const cases = [
    ["const h = createHash('sha256').update(data).digest('hex');", 'src/auth.ts'],
    ['final digest = sha256.convert(bytes);', 'lib/auth/pin.dart'],
    ['h = hashlib.sha256(data).hexdigest()', 'app/auth.py'],
    ['MessageDigest.getInstance("SHA-256");', 'src/Auth.java'],
    ['const md5Column = row.checksum;', 'src/report.ts']
  ];
  for (const [text, file] of cases) assert.deepEqual(hashIn(text, file), [], `${file}: ${text}`);
});
