// T11 (spec 023, R8, R14) — mutantes de lib/commands/init.mjs: en dry-run, la guarda pedida con el flag es la
// última línea de lo que se haría, tras el equipamiento. Dentro del proceso, para que Stryker lo vea; argv y
// HOME de chalc se fijan ANTES de importar. Sin IA (`--architecture`, `--no-ai`) y sin crear nada.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = mkdtempSync(join(tmpdir(), 'chalc-mut-init-guard-'));
after(() => rmSync(BASE, { recursive: true, force: true }));
process.env.CHALC_HOME = join(BASE, '.home');
process.argv = [process.argv[0], 'chalc', 'init', 'angular', 'demo', '--architecture', 'modular-clean-architecture',
  '--no-ai', '--dry-run', '--dir', BASE, '--guard'];

const { runInit } = await import('../lib/commands/init.mjs');
const { t } = await import('../lib/i18n.mjs');
const { c } = await import('../lib/ansi.mjs');

async function capture(fn) {
  const out = [];
  const orig = console.log;
  console.log = (m = '') => out.push(String(m));
  try { await fn(); } finally { console.log = orig; }
  return out;
}

test('init --dry-run --guard: la guarda cierra lo que se haría, tras el equipamiento, y no se crea nada', async () => {
  const out = await capture(() => runInit());
  assert.deepEqual(out.slice(-3), [c.dim(`  ▶ ${t('initDryEquip', 'claude', false)}`), c.dim(`  ▶ ${t('guardDryAdd')}`), ''], out.join('\n'));
  assert.deepEqual(readdirSync(BASE).filter((name) => name !== '.home'), []);
});
