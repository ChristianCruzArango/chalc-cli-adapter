// T9 (spec 021, R2) — el target `gemini` está retirado: se niega con un error claro, sin alias.
//
// Google retiró Gemini CLI para cuentas individuales el 2026-06-18; su reemplazo es Antigravity CLI. Pedir
// `--target gemini` tiene que decirlo y nombrar el reemplazo, nunca caer a otro target en silencio (el equipado
// interactivo cae a Claude Code cuando un target no existe: eso, para un target retirado, sería engañar).

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { RETIRED_TARGETS, TARGET_LAYOUT } from '../lib/targetfiles.mjs';
import { loadTargetModule } from '../lib/commands/equip.mjs';
import { t } from '../lib/i18n.mjs';

test('R2: gemini is retired, replaced by antigravity, and has no module or row left', () => {
  assert.deepEqual(RETIRED_TARGETS, { gemini: 'antigravity' });
  assert.equal(TARGET_LAYOUT.gemini, undefined);
  assert.ok(!existsSync(new URL('../targets/gemini.mjs', import.meta.url)));
  assert.ok(!existsSync(new URL('../lib/targetkit/geminicontext.mjs', import.meta.url)));
});

test('R2: asking for gemini fails with the retirement message, also where a missing target falls back', async () => {
  for (const fallback of [false, true]) {
    await assert.rejects(loadTargetModule('gemini', { fallback }), (err) => err.message === t('targetRetired', 'gemini', 'antigravity'), String(fallback));
  }
  assert.match(t('targetRetired', 'gemini', 'antigravity'), /antigravity/);
});

test('R2: a target that never existed keeps its old behaviour', async () => {
  await assert.rejects(loadTargetModule('nada'), (err) => err.message === t('targetMissing', 'nada'));
  assert.equal((await loadTargetModule('nada', { fallback: true })).label, 'Claude Code');
});

// Encontrado en el E2E: el CLI validaba el target por su cuenta y decía «no disponible aún». Un solo mensaje, de
// un solo sitio, para el CLI y para quien carga el módulo.
test('R2: the CLI refuses --target gemini with the retirement message and exit code 1, writing nothing', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtemp, readdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  for (const lang of ['es', 'en']) {
    const dir = await mkdtemp(join(tmpdir(), 'chalc-retired-cli-'));
    await writeFile(join(dir, 'package.json'), '{"name":"x","version":"1.0.0"}');
    const run = spawnSync(process.execPath, ['bin/chalc.mjs', dir, '--target', 'gemini', '--yes'], { encoding: 'utf8', env: { ...process.env, CHALC_LANG: lang } });
    assert.equal(run.status, 1, lang);
    assert.match(run.stderr + run.stdout, lang === 'es' ? /está retirado.*--target antigravity/ : /is retired.*--target antigravity/, lang);
    assert.deepEqual(await readdir(dir), ['package.json'], lang);
  }
});

test('R2: one helper says why a target cannot be used: retired, missing, or fine', async () => {
  const { targetProblem } = await import('../lib/commands/equip.mjs');
  assert.equal(targetProblem('gemini'), t('targetRetired', 'gemini', 'antigravity'));
  assert.equal(targetProblem('nada'), t('targetMissing', 'nada'));
  assert.equal(targetProblem('antigravity'), '');
});
