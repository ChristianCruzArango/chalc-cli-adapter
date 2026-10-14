// T12 (spec 022, R13, S6) — al copiar a un repo una skill de TERCEROS (instalada, con manifiesto) que declara
// `allowed-tools` o `hooks`, chalc lo avisa; las del catálogo propio (sin manifiesto) no generan ruido.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { copySkills } from '../lib/targetkit.mjs';
import { skillDir } from '../lib/userstore.mjs';
import { tempDir } from './helpers/tmpdir.mjs';

async function skill(catalog, id, { thirdParty }) {
  const dir = skillDir(catalog, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: x\nallowed-tools: Bash\n---\n# ${id}\n`);
  if (thirdParty) await writeFile(join(dir, '.chalc-skill.json'), JSON.stringify({ id }));
}

async function warningsOf(fn) {
  const seen = [];
  const orig = console.warn;
  console.warn = (...a) => seen.push(a.join(' '));
  try { await fn(); } finally { console.warn = orig; }
  return seen;
}

test('S6: copiar una skill de terceros con allowed-tools avisa', async (t) => {
  const root = await tempDir(t);
  const catalog = join(root, 'catalog');
  await skill(catalog, 'ajena', { thirdParty: true });
  const seen = await warningsOf(() => copySkills(catalog, ['ajena'], join(root, 'proj', '.claude', 'skills')));
  assert.equal(seen.filter((w) => w.includes('ajena') && w.includes('allowed-tools')).length, 1);
});

test('S6: una skill propia del catálogo (sin manifiesto) no avisa', async (t) => {
  const root = await tempDir(t);
  const catalog = join(root, 'catalog');
  await skill(catalog, 'propia', { thirdParty: false });
  const seen = await warningsOf(() => copySkills(catalog, ['propia'], join(root, 'proj', '.claude', 'skills')));
  assert.deepEqual(seen.filter((w) => w.includes('allowed-tools')), []);
});
