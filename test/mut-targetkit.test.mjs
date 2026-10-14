// T10 (spec 022, R19, S6/C2) — mutantes de lib/targetkit.mjs: aviso de riesgo de skills de terceros al
// copiarlas y la nota de la marca en el idioma de la interfaz cuando no hay idioma de spec.
// La interfaz se fija en español ANTES de importar (imports dinámicos): sin spec, la nota sigue a la
// interfaz, y solo en español se distingue de la que saldría con un idioma desconocido (inglés).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';

process.env.CHALC_LANG = 'es';
// Capa de usuario vacía: la skill sale del catálogo del test, no de ~/.chalc.
process.env.CHALC_HOME = mkdtempSync(join(tmpdir(), 'chalc-mut-kit-home-'));
after(() => rmSync(process.env.CHALC_HOME, { recursive: true, force: true }));
const kit = await import('../lib/targetkit.mjs');
const { t } = await import('../lib/i18n.mjs');
const { hashDir } = await import('../lib/skillsource/hashdir.mjs');
const { blockText } = await import('../lib/targetkit/blocktext.mjs');

async function catalogWith(base, id, { frontmatter = '', thirdParty = true } = {}) {
  const dir = join(base, 'catalog', 'skills', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${id}\n${frontmatter}---\nBODY\n`);
  if (thirdParty) await writeFile(join(dir, '.chalc-skill.json'), JSON.stringify({ id, contentSha256: await hashDir(dir) }));
  return join(base, 'catalog');
}

// Copia con console.warn capturado.
async function copyCapturingWarn(CATALOG, id, dest, opts) {
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(String(m));
  try { await kit.copySkills(CATALOG, [id], dest, opts); } finally { console.warn = orig; }
  return warns;
}

test('S6: una skill de terceros con hooks avisa al copiarse; sin claves de riesgo no avisa', async (t0) => {
  const base = await tempDir(t0);
  const risky = await catalogWith(join(base, 'r'), 'mut-tp-risky', { frontmatter: 'hooks: x\nallowed-tools: Bash\n' });
  const warns = await copyCapturingWarn(risky, 'mut-tp-risky', join(base, 'p1', '.chalc', 'skills'));
  assert.deepEqual(warns, [`  ! ${t('instRiskyFrontmatter', 'mut-tp-risky', 'allowed-tools, hooks')}`]);
  const clean = await catalogWith(join(base, 'c'), 'mut-tp-clean');
  assert.deepEqual(await copyCapturingWarn(clean, 'mut-tp-clean', join(base, 'p2', '.chalc', 'skills')), []);
});

test('C2: sin idioma de spec, la nota de la marca sale en el idioma de la interfaz', async (t0) => {
  const base = await tempDir(t0);
  const CATALOG = await catalogWith(base, 'mut-own', { thirdParty: false });
  const dest = join(base, 'proj', '.chalc', 'skills');
  await kit.copySkills(CATALOG, ['mut-own'], dest);
  const mark = await readFile(join(dest, 'mut-own', '.chalc-managed'), 'utf8');
  assert.ok(mark.includes(blockText('es').managedNote), mark);
});
