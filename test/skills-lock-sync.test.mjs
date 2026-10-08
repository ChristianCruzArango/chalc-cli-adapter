// S-19 — el lock registra el hash de cada skill del catálogo, y equipar copia exactamente eso.
// Si alguien cambia una skill sin volver a bloquearla, este test falla antes de publicar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashDir, SKILLS_CLI } from '../lib/install.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILLS = join(ROOT, 'catalog', 'skills');

test('every catalog skill matches the hash recorded for it', async () => {
  const lock = JSON.parse(await readFile(join(ROOT, 'skills-lock.json'), 'utf8'));
  const stale = [];
  for (const id of (await readdir(SKILLS, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const manifest = join(SKILLS, id, '.chalc-skill.json');
    const expected = existsSync(manifest)
      ? JSON.parse(await readFile(manifest, 'utf8')).contentSha256
      : lock.builtins?.[id]?.contentSha256;
    if (expected !== await hashDir(join(SKILLS, id))) stale.push(id);
  }
  assert.deepEqual(stale, [], 'skills cambiadas sin regenerar skills-lock.json (npm run lock-skills)');
});

test('external tools are pinned: skills CLI, Angular MCP and Pillow', async () => {
  assert.match(SKILLS_CLI, /^skills@\d+\.\d+\.\d+$/);
  const angular = JSON.parse(await readFile(join(ROOT, 'catalog', 'mcp', 'angular-cli.json'), 'utf8'));
  assert.deepEqual(angular.server.args.slice(0, 2), ['--no-install', '@angular/cli']);
  const setup = await readFile(join(SKILLS, 'flutter-store-assets', 'scripts', 'setup.sh'), 'utf8');
  assert.match(setup, /pillow==\d+\.\d+\.\d+/);
});
