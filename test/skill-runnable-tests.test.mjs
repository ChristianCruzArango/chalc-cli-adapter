// T6b (spec 025, R19) — una skill vendorizada no trae los archivos que `node --test` ejecutaría: la suite de chalc
// los corría (Node ≥ 22 ejecuta .ts) y eran código de ejemplo de un tercero. Tampoco cuentan en su huella, para que
// `chalc update` compare la fuente con lo instalado igual que antes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isRunnableTest } from '../lib/skillsource/runnabletest.mjs';
import { hashDir } from '../lib/skillsource/hashdir.mjs';
import { copySkillTree } from '../lib/install.mjs';

test('R19: the files Node\'s test runner would pick up are recognised', () => {
  for (const rel of ['rules/assets/graceful-server.test.ts', 'a.test.mjs', 'a.test.js', 'a.test.cjs', 'a.test.mts', 'a.test.cts',
    'x-test.js', 'x_test.ts', 'test-x.mjs', 'test.js', 'test/helper.js', 'rules/test/deep/a.ts']) {
    assert.equal(isRunnableTest(rel), true, rel);
  }
});

test('R19: documentation, assets and look-alike names stay in the skill', () => {
  for (const rel of ['SKILL.md', 'rules/assets/graceful-server.ts', 'rules/testing.md', 'contest.js', 'latest.ts',
    'test.md', 'tests/a.js', 'a.test.json', 'test/README.md', 'a.test.tsx', 'a.test.json.ts', 'mytest-x.js', 'test-x.js.md']) {
    assert.equal(isRunnableTest(rel), false, rel);
  }
});

async function skillWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-skill-tests-'));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(join(dir, rel, '..'), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
  return dir;
}

test('R19: a runnable test file does not change the skill fingerprint', async () => {
  const base = { 'SKILL.md': '# s', 'rules/assets/server.ts': 'export {}' };
  const withTest = await skillWith({ ...base, 'rules/assets/server.test.ts': 'test()' });
  assert.equal(await hashDir(withTest), await hashDir(await skillWith(base)));
});

test('R19: vendoring copies the skill without its runnable tests', async () => {
  const src = await skillWith({ 'SKILL.md': '# s', 'rules/assets/server.ts': 'export {}', 'rules/assets/server.test.ts': 'test()', 'test/a.js': 'x' });
  const dest = join(await mkdtemp(join(tmpdir(), 'chalc-vendor-')), 'skill');
  await copySkillTree(src, dest);
  assert.ok(existsSync(join(dest, 'SKILL.md')));
  assert.ok(existsSync(join(dest, 'rules/assets/server.ts')));
  assert.ok(!existsSync(join(dest, 'rules/assets/server.test.ts')));
  assert.ok(!existsSync(join(dest, 'test/a.js')));
  assert.equal(await hashDir(dest), await hashDir(src));
});

// La copia sigue los enlaces internos (ya validados): lo vendorizado es contenido real, no un enlace roto al moverlo.
test('R19: vendoring still copies an internal link as a real file', { skip: process.platform === 'win32' }, async () => {
  const src = await skillWith({ 'SKILL.md': '# s', 'rules/real.md': 'content' });
  await symlink(join(src, 'rules/real.md'), join(src, 'rules/alias.md'));
  const dest = join(await mkdtemp(join(tmpdir(), 'chalc-vendor-link-')), 'skill');
  await copySkillTree(src, dest);
  assert.ok((await lstat(join(dest, 'rules/alias.md'))).isFile());
});
