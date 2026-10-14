// test/audit022-g3-apply.test.mjs — cierre de auditoría (spec 022), grupo G3: `chalc` (apply).
// `apply.mjs` lee argv/TTY al importarse; estos tests leen su fuente para fijar el contrato.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t } from '../lib/i18n.mjs';

const src = readFileSync(new URL('../lib/commands/apply.mjs', import.meta.url), 'utf8');

// T3 (spec 022, R18, F2)
test('F2: apply instala skills nuevas en el catálogo ESCRIBIBLE del usuario, no en el del paquete', () => {
  const call = src.match(/installSkill\(\{[^}]*\}/)?.[0] || '';
  assert.match(call, /CATALOG:\s*writableLayout\(CHALC_ROOT\)\.catalog/);
});

// T3 (spec 022, R17, R19, S9, C2)
test('S9/C2: la ruta sin permisos se explica por t() y sin sugerir sudo sobre una ruta arbitraria', () => {
  assert.doesNotMatch(src, /sudo|chown/);
  assert.match(src, /t\('pathNotWritableHint'\)/);
  assert.ok(t('pathNotWritableHint').length > 0);
  assert.doesNotMatch(t('pathNotWritable', '/x'), /sudo|:\s*$/);
  assert.doesNotMatch(t('pathNotWritableHint'), /sudo|chown/);
});

// T3 (spec 022, R19, C11)
test('C11: sin código muerto targetFile/TARGETS_DIR en apply', () => {
  assert.doesNotMatch(src, /targetFile|TARGETS_DIR/);
});
