// T10 (spec 022, R18, S6) — mutantes de lib/commands/update.mjs: la línea de una skill omitida y que la
// confirmación por skill imprime atenuada por la consola del comando. En proceso, con HOME de chalc en
// tmp y color forzado ANTES de importar (imports dinámicos): sin color, `c.dim(m)` y `m` no se distinguen.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'chalc-mut-cmdupd-'));
after(() => rmSync(HOME, { recursive: true, force: true }));
process.env.CHALC_HOME = HOME;
delete process.env.NO_COLOR;
process.stdout.isTTY = true;
process.argv = [process.argv[0], 'chalc', 'update'];

const { runUpdate } = await import('../lib/commands/update.mjs');
const { installSkill } = await import('../lib/install.mjs');
const { userCatalog } = await import('../lib/userstore.mjs');
const { c } = await import('../lib/ansi.mjs');
const { t } = await import('../lib/i18n.mjs');

async function localSkill(id) {
  const src = join(HOME, 'src', id);
  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'SKILL.md'), '# v1\n');
  await installSkill({ source: src, CATALOG: userCatalog() });
  return src;
}

test('update: la skill sin confirmar sale como omitida y el error como error; los cambios, atenuados', async () => {
  const demo = await localSkill('demo');
  const gone = await localSkill('gone');
  await writeFile(join(demo, 'SKILL.md'), '# v2\n');
  await rm(gone, { recursive: true, force: true });
  const out = [];
  const orig = console.log;
  console.log = (m = '') => out.push(String(m));
  try { await runUpdate(); } finally { console.log = orig; }
  assert.ok(out.includes(c.dim(t('updateChanges', 'demo', 0, 0, 1))), out.join('\n'));
  assert.ok(out.includes(c.dim('    ~ SKILL.md')), out.join('\n'));
  assert.ok(out.includes(c.yellow(t('updateSkipped', 'demo'))), out.join('\n'));
  assert.ok(out.includes(c.red(t('updateErr', 'gone', t('updateReasonSourceUnavailable', gone)))), out.join('\n'));
});
