// T8 (spec 022, R19, C2/C11/C13) — lo que chalc deja en el repo del usuario sale en el idioma del spec, la
// plantilla de una skill solo se retira si se renderizó y no queda código muerto en targetkit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as kit from '../lib/targetkit.mjs';
import { writeLiveCommand } from '../lib/targetkit/livecommand.mjs';
import { MANAGED_MARK } from '../lib/targetkit/formats.mjs';
import { tempDir } from './helpers/tmpdir.mjs';

const SPANISH = /[áéíóúñ¿¡]|la genera|lo genera|los cambios/i;
const SKILL = 'g8-audit-skill';

async function catalogWith(base, { template = false } = {}) {
  const dir = join(base, 'catalog', 'skills', SKILL);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), '---\nname: g8\ndescription: d\n---\nORIGINAL\n');
  if (template) await writeFile(join(dir, 'SKILL.template.md'), '{{X}}\n');
  return join(base, 'catalog');
}

// T8 (spec 022, R19, C13)
test('C13: copySkills sin tools copia la skill tal cual, plantilla incluida (no la borra si no la renderizó)', async (t) => {
  const base = await tempDir(t);
  const CATALOG = await catalogWith(base, { template: true });
  const dest = join(base, 'proj', '.chalc', 'skills');
  await kit.copySkills(CATALOG, [SKILL], dest);
  assert.ok(existsSync(join(dest, SKILL, 'SKILL.template.md')), 'sin render la plantilla no se toca');
  assert.match(await readFile(join(dest, SKILL, 'SKILL.md'), 'utf8'), /ORIGINAL/);
});

// T8 (spec 022, R19, C2)
test('C2: la marca .chalc-managed de una skill sale en el idioma del spec', async (t) => {
  const base = await tempDir(t);
  const CATALOG = await catalogWith(base);
  for (const [specLang, spanish] of [['en', false], ['es', true]]) {
    const dest = join(base, `proj-${specLang}`, '.chalc', 'skills');
    await kit.copySkills(CATALOG, [SKILL], dest, { specLang });
    const mark = await readFile(join(dest, SKILL, '.chalc-managed'), 'utf8');
    assert.ok(mark.includes(MANAGED_MARK), specLang);
    assert.equal(SPANISH.test(mark), spanish, `${specLang}: ${mark}`);
  }
});

// T8 (spec 022, R19, C2)
test('C2: la marca del comando chalc-live sale en el idioma del spec', async (t) => {
  for (const [specLang, spanish] of [['en', false], ['es', true]]) {
    const proj = await tempDir(t);
    const file = await writeLiveCommand(proj, 'cursor', specLang);
    const text = await readFile(file, 'utf8');
    const markLine = text.split('\n').find((l) => l.includes(MANAGED_MARK));
    assert.ok(markLine, specLang);
    assert.equal(SPANISH.test(markLine), spanish, `${specLang}: ${markLine}`);
  }
});

// T8 (spec 022, R19, C11)
test('C11: targetkit no exporta el profileLines muerto', () => {
  assert.equal(kit.profileLines, undefined);
});

// T8 (spec 022, R19, C13)
test('C13: con tools la plantilla se renderiza en SKILL.md y se retira', async (t) => {
  const { renderMutationSkill } = await import('../lib/toolskill.mjs');
  const base = await tempDir(t);
  const CATALOG = await catalogWith(base, { template: true });
  const dest = join(base, 'proj', '.chalc', 'skills');
  const tools = { stacks: [], stack: null, tools: null };
  await kit.copySkills(CATALOG, [SKILL], dest, { tools });
  assert.ok(!existsSync(join(dest, SKILL, 'SKILL.template.md')));
  assert.equal(await readFile(join(dest, SKILL, 'SKILL.md'), 'utf8'), renderMutationSkill('{{X}}\n', tools));
});

test('copySkills: sin skills no crea nada; una copia previa de chalc se reemplaza y una del usuario se respalda', async (t) => {
  const base = await tempDir(t);
  const CATALOG = await catalogWith(base);
  const project = join(base, 'proj');
  const dest = join(project, '.chalc', 'skills');
  await kit.copySkills(CATALOG, [], dest);
  assert.ok(!existsSync(dest));

  await mkdir(join(dest, SKILL), { recursive: true });
  await writeFile(join(dest, SKILL, 'extra.md'), 'del usuario');
  const warn = console.warn; console.warn = () => {};
  try { await kit.copySkills(CATALOG, [SKILL], dest); } finally { console.warn = warn; }
  assert.ok(!existsSync(join(dest, SKILL, 'extra.md')), 'la carpeta se reemplaza limpia');
  assert.match(await readFile(join(dest, SKILL, 'SKILL.md'), 'utf8'), /ORIGINAL/);
  const backups = join(project, '.chalc', 'backups');
  assert.ok(existsSync(backups), 'lo del usuario se respaldó');

  const count = async () => (await readdir(backups, { recursive: true })).length;
  const before = await count();
  await writeFile(join(dest, SKILL, 'extra.md'), 'de chalc');
  await kit.copySkills(CATALOG, [SKILL], dest);   // ya lleva la marca: se reemplaza sin respaldo nuevo
  assert.ok(!existsSync(join(dest, SKILL, 'extra.md')));
  assert.equal(await count(), before);
});
