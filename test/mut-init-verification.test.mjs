// Spec 029 (R8) y 016 — mutantes de lib/commands/init.mjs: cada chequeo de la verificación se anuncia con SU
// texto, incluido el de las herramientas de `.chalc/`. Dentro del proceso, para que Stryker lo vea; argv y HOME
// de chalc se fijan ANTES de importar (el módulo lee la línea de comandos al cargarse).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = mkdtempSync(join(tmpdir(), 'chalc-mut-init-verify-'));
after(() => rmSync(BASE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
process.env.CHALC_HOME = join(BASE, '.home');
process.argv = [process.argv[0], 'chalc', 'init', 'angular', 'demo', '--architecture', 'modular-clean-architecture', '--no-ai', '--dry-run', '--dir', BASE];

const { printVerification } = await import('../lib/commands/init.mjs');
const { t } = await import('../lib/i18n.mjs');

const LABELS = { folders: 'vChkFolders', folderDocs: 'vChkFolderDocs', architectureDoc: 'vChkArchitectureDoc', specs: 'vChkSpecs', manifest: 'vChkManifest', assistant: 'vChkAssistant', tooling: 'vChkTooling' };
// Sin colores: se compara el texto que lee el usuario.
const plain = (line) => String(line).replace(/\u001b\[\d+m/g, '');
function printed(result) {
  const out = [];
  const original = console.log;
  console.log = (line = '') => out.push(plain(line));
  try { return { ok: printVerification(result), out }; } finally { console.log = original; }
}

test('cada chequeo que pasa se anuncia con su texto, y el de las herramientas de .chalc/ también', () => {
  const { ok, out } = printed({ ok: true, checks: Object.keys(LABELS).map((key) => ({ key, ok: true })), violations: [] });
  assert.equal(ok, true);
  assert.deepEqual(out.slice(1, 1 + Object.keys(LABELS).length), Object.values(LABELS).map((label) => `  ✓ ${t(label)}`));
  assert.equal(new Set(Object.values(LABELS).map((label) => t(label))).size, Object.keys(LABELS).length, 'ningún texto se repite');
  assert.equal(out.at(-1), `  ✓ ${t('vBoundariesOk')}`);
});

test('un chequeo que falla dice qué falta; uno sin etiqueta se nombra por su clave', () => {
  const { ok, out } = printed({ ok: false, checks: [{ key: 'tooling', ok: false, items: ['.chalc/gate.mjs'] }, { key: 'otro', ok: true }], violations: [] });
  assert.equal(ok, false);
  assert.equal(out[1], `  ✗ ${t('vChkTooling')}  · ${t('vMissing', '.chalc/gate.mjs')}`);
  assert.equal(out[2], `  ✓ ${t('otro')}`);
});
