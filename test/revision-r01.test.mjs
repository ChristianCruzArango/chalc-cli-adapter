// R-01 (spec 016, R5) — las invocaciones AUTOMÁTICAS de git (inspección, gitprep, revisor, portón)
// no ejecutan lo que diga una `.git/config` hostil: core.fsmonitor desactivado y diff sin
// herramientas externas (diff.external, diff.<driver>.command, textconv).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, gitStatus } from '../lib/gitprep.mjs';
import { inspectProject } from '../cli/project.mjs';
import { collectChanges } from '../cli/engine/review.mjs';
import { changedLineInfo, changedSince } from '../catalog/gate/lib/changed.mjs';

const MARKERS = ['fsmonitor', 'external', 'command', 'textconv'];
const IS_WINDOWS = process.platform === 'win32';

// Repo con un commit y a.txt modificado; cada herramienta hostil deja su marcador si llega a correr.
async function hostileRepo() {
  const root = await mkdtemp(join(tmpdir(), 'chalc-r01-'));
  const run = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  run('init', '--quiet');
  await writeFile(join(root, 'a.txt'), 'uno\n');
  run('add', 'a.txt');
  run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init');
  for (const name of MARKERS) {
    const script = join(root, `${name}.sh`);
    await writeFile(script, `#!/bin/sh\nprintf x > "${join(root, `${name}.marker`)}"\nprintf '\\0'\n`);
    await chmod(script, 0o700);
  }
  run('config', 'core.fsmonitor', join(root, 'fsmonitor.sh'));
  run('config', 'diff.external', join(root, 'external.sh'));
  run('config', 'diff.evil.command', join(root, 'command.sh'));
  run('config', 'diff.evil.textconv', join(root, 'textconv.sh'));
  await writeFile(join(root, '.git', 'info', 'attributes'), '*.txt diff=evil\n');
  await writeFile(join(root, 'a.txt'), 'uno\ndos\n');
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const fired = (root) => MARKERS.filter((name) => existsSync(join(root, `${name}.marker`)));

test('R5: gitprep (status and its git runner) runs neither fsmonitor nor external diff tools (diff, log, show)', { skip: IS_WINDOWS }, async () => {
  const { root, cleanup } = await hostileRepo();
  try {
    const status = await gitStatus(root);
    assert.equal(status.isRepo, true);
    await git(['status', '--porcelain'], root);
    await git(['diff', 'HEAD'], root);
    assert.deepEqual(fired(root), []);
    const log = await git(['log', '-p', '-1'], root);
    const show = await git(['show', 'HEAD'], root);
    assert.deepEqual(fired(root), []);
    assert.match(log.out, /^\+uno$/m);
    assert.match(show.out, /^\+uno$/m);
  } finally { await cleanup(); }
});

test('R5: opening the project (inspectProject) does not run fsmonitor', { skip: IS_WINDOWS }, async () => {
  const { root, cleanup } = await hostileRepo();
  try {
    await inspectProject(root);
    assert.deepEqual(fired(root), []);
  } finally { await cleanup(); }
});

test('R5: the reviewer diff uses no external diff tools and still shows the real diff', { skip: IS_WINDOWS }, async () => {
  const { root, cleanup } = await hostileRepo();
  try {
    const material = await collectChanges(root, ['a.txt']);
    assert.deepEqual(fired(root), []);
    assert.match(material, /^\+dos$/m);
  } finally { await cleanup(); }
});

test('R5: the gate scope and line info use no fsmonitor nor external diff tools', { skip: IS_WINDOWS }, async () => {
  const { root, cleanup } = await hostileRepo();
  try {
    const info = await changedLineInfo(root, 'HEAD');
    await changedSince(root, 'HEAD');
    assert.deepEqual(fired(root), []);
    assert.deepEqual([...(info.lines.get('a.txt') || [])], [2]);
  } finally { await cleanup(); }
});
