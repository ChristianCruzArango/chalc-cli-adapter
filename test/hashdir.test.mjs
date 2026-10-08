// F-18 — el hash de una skill es el mismo en todos los SO y no confunde contenidos distintos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashDir } from '../lib/install.mjs';
import { checkSkillUpdate } from '../lib/update.mjs';

async function tree(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-f18-'));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(join(dir, rel, '..'), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
  return dir;
}

test('CRLF checkouts (git on Windows) hash like LF ones; binaries are hashed raw', async () => {
  assert.equal(await hashDir(await tree({ 'SKILL.md': 'a\r\nb\r\n', 'refs/x.md': 'c\r\n' })), await hashDir(await tree({ 'SKILL.md': 'a\nb\n', 'refs/x.md': 'c\n' })));
  assert.notEqual(await hashDir(await tree({ 'img.bin': Buffer.from([0, 13, 10]) })), await hashDir(await tree({ 'img.bin': Buffer.from([0, 10]) })));
});

test('names and contents are delimited: a+bc is not ab+c', async () => {
  assert.notEqual(await hashDir(await tree({ a: 'bc' })), await hashDir(await tree({ ab: 'c' })));
});

test('a manifest from the previous hash version is compared against the installed content, not marked outdated', async () => {
  const installed = await tree({ 'demo/SKILL.md': '---\nname: demo\n---\n' });
  const source = await tree({ 'demo/SKILL.md': '---\nname: demo\n---\n' });
  const manifest = { source: join(source, 'demo'), sourceType: 'local', contentSha256: 'hash-v1-antiguo' };
  const r = await checkSkillUpdate({ id: 'demo', manifest, installedDir: join(installed, 'demo') });
  assert.equal(r.status, 'fresh');
});
