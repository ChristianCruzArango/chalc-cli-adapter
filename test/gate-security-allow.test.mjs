// spec 014 · T10 (R12, R13) — silenciar un falso positivo dejando el motivo escrito.
//
// Sin una salida para los falsos positivos, la etapa se acaba apagando entera con
// `security.enabled: false`. Con una salida SIN motivo, se silencia hallazgo a hallazgo y nadie sabe
// por qué. La salida exige el motivo, y cada supresión queda a la vista en la evidencia.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFile, scanSource } from '../catalog/gate/lib/security.mjs';

const MD5 = "const md5 = (b) => createHash('md5').update(b).digest();";

test('R12: an allow with a reason on the line above silences that finding', async () => {
  const text = `// chalc-allow: weak-hash — RC4 de Excel exige MD5 por especificación\n${MD5}\n`;
  const { findings, allowed } = scanFile(text, { file: 'lib/xls.mjs' });

  assert.deepEqual(findings, []);
  assert.equal(allowed.length, 1);
  assert.deepEqual(
    { line: allowed[0].line, rule: allowed[0].rule, reason: allowed[0].reason },
    { line: 2, rule: 'weak-hash', reason: 'RC4 de Excel exige MD5 por especificación' }
  );
});

test('R12: an allow at the end of the same line works too, in any comment style', async () => {
  const cases = [
    [`${MD5} // chalc-allow: weak-hash — lo pide el formato RC4 de Excel`, 'lib/xls.mjs'],
    ["h = hashlib.md5(b).digest()  # chalc-allow: weak-hash -- checksum de caché, no seguridad", 'app/cache.py'],
    [`/* chalc-allow: weak-hash - etag de caché sin uso criptográfico */\n${MD5}`, 'src/etag.ts']
  ];
  for (const [text, file] of cases) assert.deepEqual(scanSource(text, { file }), [], `${file}: ${text}`);
});

// La supresión es por regla: justificar el MD5 no puede tapar un secreto en la misma línea.
test('R12: an allow only silences the rule it names', async () => {
  const text = "// chalc-allow: weak-hash — checksum de caché sin uso criptográfico\nconst apiKey = 'a1b2c3d4e5f6'; const h = createHash('md5');\n";
  assert.deepEqual(scanSource(text, { file: 'src/cache.ts' }).map((f) => f.rule), ['hardcoded-secret']);
});

// Dos líneas más arriba ya no es «esta línea»: la supresión no puede alcanzar a lo que vino después.
test('R12: an allow does not reach further than the next line', async () => {
  const text = `// chalc-allow: weak-hash — checksum de caché sin uso criptográfico\nconst x = 1;\n${MD5}\n`;
  assert.deepEqual(scanSource(text, { file: 'src/cache.ts' }).map((f) => f.rule), ['weak-hash']);
});

test('R13: an allow without a reason silences nothing and is reported', async () => {
  for (const comment of ['// chalc-allow: weak-hash', '// chalc-allow: weak-hash —', '// chalc-allow: weak-hash — ok', '// chalc-allow: weak-hash — es seguro']) {
    const { findings, allowed } = scanFile(`${comment}\n${MD5}\n`, { file: 'lib/xls.mjs' });
    const rules = findings.map((f) => f.rule).sort();

    assert.deepEqual(rules, ['allow-without-reason', 'weak-hash'], comment);
    assert.deepEqual(allowed, [], comment);
    const bad = findings.find((f) => f.rule === 'allow-without-reason');
    assert.equal(bad.line, 1);
    assert.equal(bad.data.rule, 'weak-hash');
  }
});

// Un `chalc-allow` sin motivo es un hallazgo aunque ya no tape nada: queda escrito y engaña al lector.
test('R13: a reasonless allow is reported even with nothing to silence', async () => {
  const findings = scanSource('// chalc-allow: tls-disabled\nconst x = 1;\n', { file: 'src/a.ts' });
  assert.deepEqual(findings.map((f) => [f.rule, f.line, f.data.rule]), [['allow-without-reason', 1, 'tls-disabled']]);
});
