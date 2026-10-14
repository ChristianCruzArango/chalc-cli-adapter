// T10 (spec 022, R16, R17, S8/S9) — mutantes: qué cuenta como «un archivo» para el `Grep` de contenido, qué
// lo acota, a qué herramientas se aplica, y la redacción de contraseñas pasadas por bandera de comando.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/gate/lib/guard-rules.mjs';
import { redactSensitiveText } from '../catalog/gate/lib/redact.mjs';

const grep = (input) => decide({ tool_name: 'Grep', tool_input: { pattern: 'x', output_mode: 'content', ...input } });

// T10 (spec 022, R16, S8)
test('S8: a single named file passes, even with a one-letter name or a bare file name', () => {
  for (const path of ['app.ts', 'src/a.ts', 'src/a..ts', 'C:\\src\\a.ts']) assert.equal(grep({ path }).decision, 'allow', path);
});

// T10 (spec 022, R16, S8)
test('S8: a folder asks even if a parent folder or a dotfile looks like a file', () => {
  for (const path of ['pkg.v2/src', 'src/.hidden', 'src/', '..']) {
    const verdict = grep({ path });
    assert.deepEqual([verdict.decision, verdict.rule, verdict.data], ['ask', 'secret-grep', { path }], path);
  }
});

// T10 (spec 022, R16, S8)
test('S8: an empty path or an empty type does not narrow anything: it asks about the project root', () => {
  assert.deepEqual(grep({ path: '' }).data, { path: '.' });
  assert.equal(grep({ path: 'src', type: '' }).decision, 'ask');
  assert.deepEqual(grep({ path: 7 }).data, { path: '.' });
});

// T10 (spec 022, R16, S8)
test('S8: the folder rule is only for Grep: reading a file never asks about folders', () => {
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: 'src/app.ts' } }).decision, 'allow');
  assert.equal(decide({ tool_name: 'Glob', tool_input: { pattern: '**/*.ts', output_mode: 'content' } }).decision, 'allow');
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'ls' } }).decision, 'allow');
});

// T10 (spec 022, R17, S9)
test('S9: --password/--token values are redacted whole, after any spacing and inside quotes', () => {
  assert.equal(redactSensitiveText('cli --password   hunter2 x'), 'cli --password   [REDACTED] x');
  assert.equal(redactSensitiveText('cli --password "dos palabras" x'), 'cli --password [REDACTED] x');
  assert.equal(redactSensitiveText("cli --token 'dos palabras' x"), 'cli --token [REDACTED] x');
  assert.equal(redactSensitiveText('cli --token="" x'), 'cli --token=[REDACTED] x');
});

// T10 (spec 022, R17, S9)
test('S9: user:password after -u is redacted at the start of the text and after several spaces', () => {
  assert.equal(redactSensitiveText('-u ana:clave https://x'), '-u [REDACTED] https://x');
  assert.equal(redactSensitiveText('curl -u   ana:clave https://x'), 'curl -u   [REDACTED] https://x');
});

// T10 (spec 022, R17, S9)
test('S9: the glued -p password of mysql/mariadb tools is redacted, whatever the tool suffix', () => {
  assert.equal(redactSensitiveText('mysqldump -u root -pSecreto db'), 'mysqldump -u root -p[REDACTED] db');
  assert.equal(redactSensitiveText('mariadb -u root -pSecreto db'), 'mariadb -u root -p[REDACTED] db');
  assert.equal(redactSensitiveText('mariadbd -u root -pSecreto'), 'mariadbd -u root -p[REDACTED]');
});
