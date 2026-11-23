// Specs 027 (R9), 034 (R1, R4) — lo que `emitRepoTools` cablea al equipar: el idioma de las instrucciones de cada
// rol, las skills que recibe el equipo y los temporales de mutación fuera de git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { emitRepoTools } from '../lib/commands/equip.mjs';
import { t as tr } from '../lib/i18n.mjs';

// Equipa en silencio: los avisos de consola no son lo que se mira aquí.
async function emitted(t, options, pkg = { name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }) {
  const dir = await tempDir(t, 'chalc-034-wiring-');
  if (pkg) await writeFile(join(dir, 'package.json'), JSON.stringify(pkg));
  const original = console.log;
  console.log = () => {};
  try { return { dir, config: await emitRepoTools(dir, options) }; } finally { console.log = original; }
}
const read = (dir, ...rel) => readFile(join(dir, ...rel), 'utf8');

test('R1 (034): sin idioma de spec, las instrucciones de los roles salen en el idioma del portón', async (t) => {
  const en = await emitted(t, { language: 'en' });
  assert.equal(en.config.language, 'en');
  assert.match(await read(en.dir, '.chalc', 'roles', 'desarrollador.md'), /^You are the \*\*developer\*\*/m);
  const es = await emitted(t, { language: 'es' });
  assert.match(await read(es.dir, '.chalc', 'roles', 'desarrollador.md'), /^Eres /m);
});

test('R1 (034): el idioma de la spec manda sobre el del portón', async (t) => {
  const { dir } = await emitted(t, { language: 'en', specLang: 'es' });
  assert.match(await read(dir, '.chalc', 'roles', 'desarrollador.md'), /^Eres /m);
  const other = await emitted(t, { language: 'es', specLang: 'en' });
  assert.match(await read(other.dir, '.chalc', 'roles', 'desarrollador.md'), /^You are the \*\*developer\*\*/m);
});

test('R4 (034): las skills del proyecto llegan al Desarrollador en team.json y a sus instrucciones', async (t) => {
  const { dir } = await emitted(t, { language: 'es', skills: ['clean-code', 'react-patterns'] });
  const team = JSON.parse(await read(dir, '.chalc', 'team.json'));
  assert.ok(team.roles.desarrollador.skills.includes('react-patterns'), JSON.stringify(team.roles.desarrollador));
  const none = await emitted(t, { language: 'es' });
  assert.equal(JSON.parse(await read(none.dir, '.chalc', 'team.json')).roles.desarrollador.skills.includes('react-patterns'), false);
});

test('R9 (027): los temporales de la herramienta de mutación del stack quedan fuera de git, bajo su cabecera', async (t) => {
  const { dir } = await emitted(t, { language: 'es' });
  const ignore = await read(dir, '.gitignore');
  assert.ok(ignore.includes(`# ${tr('gitignoreMutationHeader')}`) || ignore.includes(tr('gitignoreMutationHeader')), ignore);
  assert.match(ignore, /^\.stryker-tmp\/$/m);
  assert.match(ignore, /^reports\/mutation\/$/m);
  const plain = await emitted(t, { language: 'es' }, null);
  const text = existsSync(join(plain.dir, '.gitignore')) ? await read(plain.dir, '.gitignore') : '';
  assert.equal(text.includes('.stryker-tmp/'), false, 'sin stack reconocido no hay herramienta de mutación que ignorar');
  assert.equal(text.includes(tr('gitignoreMutationHeader')), false);
});
