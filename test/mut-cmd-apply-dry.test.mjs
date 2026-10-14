// T10 (spec 022, R18/R19, F2) — mutantes de lib/commands/apply.mjs: el destino elegido llega hasta la
// aplicación (dry-run de punta a punta) y el paso interactivo de instalar skills nuevas usa el catálogo
// escribible y el log del comando. argv y HOME de chalc se fijan ANTES de importar (import dinámico).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = mkdtempSync(join(tmpdir(), 'chalc-mut-apply-dry-'));
after(() => rmSync(BASE, { recursive: true, force: true }));
const PROJ = join(BASE, 'proj');
await mkdir(PROJ);
process.env.CHALC_HOME = join(BASE, 'home');
process.argv = [process.argv[0], 'chalc', PROJ, '--dry-run', '--target', 'claude'];

const { runApply, installNewSkills } = await import('../lib/commands/apply.mjs');
const { userCatalog } = await import('../lib/userstore.mjs');
const { t } = await import('../lib/i18n.mjs');
const { c } = await import('../lib/ansi.mjs');

async function capture(fn) {
  const out = [];
  const orig = console.log;
  console.log = (m = '') => out.push(String(m));
  try { await fn(); } finally { console.log = orig; }
  return out;
}

test('apply --dry-run: el destino elegido llega hasta el plan, sin escribir en el proyecto', async () => {
  const out = await capture(() => runApply());
  assert.ok(out.some((l) => l.includes(t('planDry'))), out.join('\n'));
  assert.equal(existsSync(join(PROJ, '.chalc.json')), false);
});

test('apply: instalar una skill nueva la deja en el catálogo del usuario con el log del comando', async () => {
  const src = join(BASE, 'src', 'mut-tp');
  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'SKILL.md'), '---\nhooks: x\n---\n# tp\n');
  const answers = [true, true, false];   // ¿instalar? sí · ¿skill con hooks? sí · ¿otra? no
  const prompter = {
    yesno: async () => answers.shift(),
    text: async () => src,
    select: async (_q, opts) => opts.findIndex((o) => o.value === null)   // sin regla: solo catálogo
  };
  const skills = [];
  const out = await capture(() => installNewSkills(prompter, [], skills));
  assert.deepEqual(skills, ['mut-tp']);
  assert.ok(existsSync(join(userCatalog(), 'skills', 'mut-tp', 'SKILL.md')));
  assert.ok(out.includes(c.dim('  ' + t('instRiskyFrontmatter', 'mut-tp', 'hooks'))), out.join('\n'));
  assert.ok(out.includes(c.green('  ✓ ' + t('installedOk', 'mut-tp'))), out.join('\n'));
});
