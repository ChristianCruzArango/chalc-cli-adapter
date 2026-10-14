// T10 (spec 022, R19, S9/C2) — mutantes de lib/commands/apply.mjs: una ruta sin permiso de escritura se
// explica con la pista localizada. `apply.mjs` lee argv al importarse: se fija ANTES (import dinámico).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RO = mkdtempSync(join(tmpdir(), 'chalc-mut-apply-ro-'));
chmodSync(RO, 0o555);
after(() => { chmodSync(RO, 0o755); rmSync(RO, { recursive: true, force: true }); });
process.argv = [process.argv[0], 'chalc', RO, '--dry-run'];

const { runApply } = await import('../lib/commands/apply.mjs');
const { t } = await import('../lib/i18n.mjs');
const { c } = await import('../lib/ansi.mjs');

const skip = process.platform === 'win32' || process.getuid?.() === 0;

test('apply: ruta sin escritura → error y pista sangrada, y el comando termina con código 1', { skip }, async () => {
  const out = [];
  const orig = console.log;
  console.log = (m = '') => out.push(String(m));
  try {
    await assert.rejects(runApply(), { name: 'CommandExit', exitCode: 1 });
  } finally { console.log = orig; }
  assert.ok(out.includes(c.red('✗ ' + t('pathNotWritable', RO))), out.join('\n'));
  assert.ok(out.includes(c.dim('  ' + t('pathNotWritableHint'))), out.join('\n'));
});
