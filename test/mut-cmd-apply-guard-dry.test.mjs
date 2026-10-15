// T10 (spec 023, R8, R14) — mutantes de lib/commands/apply.mjs: en dry-run, la guarda es una línea más del plan, marcada como el resto.
// Dentro del proceso, para que Stryker lo vea; argv y HOME de chalc se fijan ANTES de importar.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = mkdtempSync(join(tmpdir(), 'chalc-mut-apply-guard-'));
after(() => rmSync(BASE, { recursive: true, force: true }));
const PROJ = join(BASE, 'proj');
await mkdir(PROJ);
process.env.CHALC_HOME = join(BASE, 'home');
process.argv = [process.argv[0], 'chalc', PROJ, '--dry-run', '--target', 'claude', '--guard'];

const { runApply } = await import('../lib/commands/apply.mjs');
const { t } = await import('../lib/i18n.mjs');
const { c } = await import('../lib/ansi.mjs');

async function capture(fn) {
  const out = [];
  const orig = console.log;
  console.log = (m = '') => out.push(String(m));
  try { await fn(); } finally { console.log = orig; }
  return out;
}

test('apply --dry-run --guard: la guarda sale en el plan con la marca del plan', async () => {
  const out = await capture(() => runApply());
  assert.ok(out.includes('  ' + c.dim('· ') + t('guardDryAdd')), out.join('\n'));
  assert.equal(existsSync(join(PROJ, '.claude', 'settings.local.json')), false);
});
