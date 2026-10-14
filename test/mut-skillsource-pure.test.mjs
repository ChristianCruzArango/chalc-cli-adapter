// T10 (spec 022, R18, S6/S9/F-18) — mutantes de lib/skillsource puros: within, pin, diff, hashdir, risk,
// urlcreds. Cada test fija el comportamiento observable que un mutante superviviente cambiaba.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { within } from '../lib/skillsource/within.mjs';
import { splitPin } from '../lib/skillsource/pin.mjs';
import { diffSkillDirs } from '../lib/skillsource/diff.mjs';
import { byName, hashDir, isChalcFile, walkFiles } from '../lib/skillsource/hashdir.mjs';
import { riskyFrontmatterKeys } from '../lib/skillsource/risk.mjs';
import { hasUrlCredentials, stripUrlCredentials } from '../lib/skillsource/urlcreds.mjs';

// ---------- within ----------
test('within: la misma ruta, una hija y una hermana con prefijo común', () => {
  assert.equal(within('/tmp/a', '/tmp/a'), true);
  assert.equal(within('/tmp/a', '/tmp/a/b/c'), true);
  assert.equal(within('/tmp/a', '/tmp/ab'), false);
  assert.equal(within('/tmp/a', '/tmp'), false);
  assert.equal(within('/tmp/a', '/tmp/a/..foo'), true);
});

// ---------- pin ----------
test('pin: solo una fuente ENTERA `<url>@<sha>` lleva pin', () => {
  assert.deepEqual(splitPin('https://github.com/o/r@ABCDEF1'), { base: 'https://github.com/o/r', pin: 'abcdef1' });
  // sin `^`: un trozo final con `/` se tomaría como fuente fijada
  assert.deepEqual(splitPin('x y/z@abcdef1'), { base: 'x y/z@abcdef1', pin: null });
  // sin `$`: un sha seguido de basura se tomaría como pin
  assert.deepEqual(splitPin('o/r@abcdef1234xyz'), { base: 'o/r@abcdef1234xyz', pin: null });
  // `ab@…` (sin `/` ni `:`) no es una URL: no es pin aunque el sufijo parezca un sha
  assert.deepEqual(splitPin('ab@abcdef1'), { base: 'ab@abcdef1', pin: null });
  assert.deepEqual(splitPin('a@abcdef1'), { base: 'a@abcdef1', pin: null });
});

// ---------- diff ----------
async function skill(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(dir, rel, '..'), { recursive: true });
    await writeFile(join(dir, rel), body);
  }
  return dir;
}

test('diff: un archivo idéntico no cuenta como modificado; uno cambiado sí', async (t) => {
  const base = await tempDir(t);
  const a = await skill(join(base, 'a'), { 'SKILL.md': 'x\n', 'same.md': 'igual\n', 'old.md': '1' });
  const b = await skill(join(base, 'b'), { 'SKILL.md': 'y\n', 'same.md': 'igual\n', 'new.md': '2' });
  assert.deepEqual(await diffSkillDirs(a, b), { added: ['new.md'], removed: ['old.md'], modified: ['SKILL.md'] });
});

test('diff: sin carpeta anterior (null o inexistente) todo es añadido', async (t) => {
  const base = await tempDir(t);
  const b = await skill(join(base, 'b'), { 'SKILL.md': 'y\n' });
  const all = { added: ['SKILL.md'], removed: [], modified: [] };
  assert.deepEqual(await diffSkillDirs(null, b), all);
  assert.deepEqual(await diffSkillDirs(join(base, 'no-existe'), b), all);
});

// ---------- hashdir ----------
test('hashdir: byName ordena por código y da 0 con el mismo nombre', () => {
  assert.equal(byName({ name: 'a' }, { name: 'b' }), -1);
  assert.equal(byName({ name: 'b' }, { name: 'a' }), 1);
  assert.equal(byName({ name: 'a' }, { name: 'a' }), 0);
});

test('hashdir: walkFiles recorre en orden fijo aunque readdir devuelva otro', async (t) => {
  const dir = await tempDir(t);
  for (const n of ['b', 'c', 'a']) await writeFile(join(dir, n), n);
  const ent = (name) => ({ name, isDirectory: () => false });
  const seen = [];
  await walkFiles(dir, (rel) => { seen.push(rel); }, { list: async () => [ent('c'), ent('a'), ent('b')] });
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('hashdir: los archivos de chalc no cambian la huella', async (t) => {
  const dir = await skill(await tempDir(t), { 'SKILL.md': 'x\n' });
  const before = await hashDir(dir);
  await writeFile(join(dir, '.chalc-skill.json'), '{}');
  await writeFile(join(dir, '.chalc-managed'), 'm');
  assert.equal(await hashDir(dir), before);
  assert.equal(isChalcFile('.chalc-skill.json'), true);
  assert.equal(isChalcFile('.chalc-managed'), true);
  assert.equal(isChalcFile(''), false);
  assert.equal(isChalcFile('sub/.chalc-managed'), false);
});

test('hashdir: una barra invertida en el nombre se entrega como `/`', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await tempDir(t);
  await writeFile(join(dir, 'a\\b'), 'x');
  const seen = [];
  await walkFiles(dir, (rel) => { seen.push(rel); });
  assert.deepEqual(seen, ['a/b']);
});

// ---------- risk ----------
async function riskOf(t, md) {
  const dir = await tempDir(t);
  if (md !== null) await writeFile(join(dir, 'SKILL.md'), md);
  return riskyFrontmatterKeys(dir);
}

test('risk: sin SKILL.md no hay claves de riesgo', async (t) => {
  assert.deepEqual(await riskOf(t, null), []);
});

test('risk: frontmatter con BOM, sin salto final y con espacio antes de los dos puntos', async (t) => {
  assert.deepEqual(await riskOf(t, '﻿---\nhooks: x\n---\nbody\n'), ['hooks']);
  assert.deepEqual(await riskOf(t, '---\nname: n\n\nhooks : x\n---'), ['hooks']);
});

test('risk: solo cuenta el frontmatter del INICIO y las claves de nivel raíz', async (t) => {
  assert.deepEqual(await riskOf(t, 'intro\n---\nhooks: x\n---\n'), []);
  assert.deepEqual(await riskOf(t, '---\nmetadata:\n  hooks: x\n---\n'), []);
  assert.deepEqual(await riskOf(t, '---\n﻿hooks: x\n---\n'), []);
});

test('risk: variantes allowed_tools y allowedtools (sin distinguir mayúsculas)', async (t) => {
  assert.deepEqual(await riskOf(t, '---\nallowed_tools: Bash\n---\n'), ['allowed-tools']);
  assert.deepEqual(await riskOf(t, '---\nAllowedTools: Bash\n---\n'), ['allowed-tools']);
  assert.deepEqual(await riskOf(t, '---\nallowed-tools: Bash\nhooks: y\n---\n'), ['allowed-tools', 'hooks']);
});

// ---------- urlcreds ----------
test('urlcreds: http(s) con usuario es credencial; ssh solo con contraseña; esquemas compuestos no son http', () => {
  assert.equal(hasUrlCredentials('http://user@github.com/o/r'), true);
  assert.equal(hasUrlCredentials('https://tok@github.com/o/r'), true);
  assert.equal(hasUrlCredentials('ssh://git@github.com/o/r'), false);
  assert.equal(hasUrlCredentials('ssh://git:pw@github.com/o/r'), true);
  assert.equal(hasUrlCredentials('git+https://user@host/o/r'), false);
  assert.equal(hasUrlCredentials('nada que ver'), false);
});

test('urlcreds: una URL que no se puede parsear no es credencial ni lanza', () => {
  assert.equal(hasUrlCredentials('http://[x'), false);
  assert.equal(stripUrlCredentials('http://[x'), 'http://[x');
});

test('urlcreds: strip quita solo el secreto y deja intacto el usuario de ssh', () => {
  assert.equal(stripUrlCredentials('npx skills add https://u:p@github.com/o/r --x'), 'npx skills add https://github.com/o/r --x');
  assert.equal(stripUrlCredentials('ssh://git@github.com/o/r'), 'ssh://git@github.com/o/r');
  assert.equal(stripUrlCredentials(undefined), '');
  assert.equal(stripUrlCredentials(null), '');
});
