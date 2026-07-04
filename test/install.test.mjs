import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifySource, installSkill } from '../lib/install.mjs';

test('classifySource distingue git, local y skills.sh', async () => {
  assert.equal(classifySource('https://github.com/owner/repo'), 'git');
  assert.equal(classifySource('git@github.com:owner/repo.git'), 'git');
  assert.equal(classifySource('npx add-skill owner/repo --skill x'), 'skillssh');
  assert.equal(classifySource('.'), 'local');
  assert.equal(classifySource('algo-que-no-existe-9f3k'), 'skillssh');
});

async function makeSkill(root, id, files) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of files) await writeFile(join(dir, name), content, 'utf8');
  return dir;
}

test('installSkill vendoriza una fuente local y el hash no depende del orden de escritura', async () => {
  const work = await mkdtemp(join(tmpdir(), 'chalc-install-'));
  try {
    const catalog = join(work, 'catalog');
    await mkdir(join(catalog, 'skills'), { recursive: true });

    // Mismo contenido, archivos escritos en orden distinto: contentSha256 debe coincidir.
    const a = await makeSkill(work, 'skill-a', [['SKILL.md', '# S\n'], ['extra.md', 'x\n']]);
    const b = await makeSkill(work, 'skill-b', [['extra.md', 'x\n'], ['SKILL.md', '# S\n']]);

    const idsA = await installSkill({ source: a, CATALOG: catalog, allowExternalExec: true });
    const idsB = await installSkill({ source: b, CATALOG: catalog, allowExternalExec: true });
    assert.deepEqual(idsA, ['skill-a']);
    assert.deepEqual(idsB, ['skill-b']);

    const metaA = JSON.parse(await readFile(join(catalog, 'skills', 'skill-a', '.chalc-skill.json'), 'utf8'));
    const metaB = JSON.parse(await readFile(join(catalog, 'skills', 'skill-b', '.chalc-skill.json'), 'utf8'));
    assert.equal(metaA.contentSha256, metaB.contentSha256);
    assert.equal(metaA.sourceType, 'local');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('installSkill sin prompter no reemplaza un skill existente salvo --force', async () => {
  const work = await mkdtemp(join(tmpdir(), 'chalc-install-'));
  try {
    const catalog = join(work, 'catalog');
    await mkdir(join(catalog, 'skills'), { recursive: true });
    const src = await makeSkill(work, 'dup', [['SKILL.md', '# v1\n']]);

    await installSkill({ source: src, CATALOG: catalog, allowExternalExec: true });
    await assert.rejects(
      () => installSkill({ source: src, CATALOG: catalog, allowExternalExec: true }),
      /--force/
    );
    await writeFile(join(src, 'SKILL.md'), '# v2\n', 'utf8');
    await installSkill({ source: src, CATALOG: catalog, allowExternalExec: true, force: true });
    assert.equal(await readFile(join(catalog, 'skills', 'dup', 'SKILL.md'), 'utf8'), '# v2\n');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
