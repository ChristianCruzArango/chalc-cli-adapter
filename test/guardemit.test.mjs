// T6 (spec 023, R1, R3, R4, R6, R7, R15) — la guarda en disco: `.claude/settings.local.json`.
//
// `enableGuard` / `disableGuard` leen el archivo LOCAL del asistente, le aplican la fusión pura
// (`guardsettings.mjs`) y lo escriben. Nunca tocan `.claude/settings.json`, que va commiteado. Lo que no
// entienden (JSON inválido, otra forma, una carpeta o un enlace en su lugar) lo dejan tal cual: `invalid`.
// Devuelven un estado; no imprimen nada.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { disableGuard, enableGuard, GUARD_IGNORE } from '../lib/guardemit.mjs';
import { GUARD_STATUS } from '../lib/guardstatus.mjs';
import { withGuard } from '../lib/guardsettings.mjs';
import { t as tr } from '../lib/i18n.mjs';

const local = (dir) => join(dir, '.claude', 'settings.local.json');
const shared = (dir) => join(dir, '.claude', 'settings.json');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const read = (path) => readFile(path, 'utf8');

async function project(t, settings) {
  const dir = await tempDir(t, 'chalc-guardemit-');
  if (settings !== undefined) {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(local(dir), settings);
  }
  return dir;
}

test('R1: the guard states are a closed set', () => {
  assert.deepEqual(GUARD_STATUS, { added: 'added', unchanged: 'unchanged', removed: 'removed', absent: 'absent', invalid: 'invalid' });
  assert.ok(Object.isFrozen(GUARD_STATUS));
});

test('R1, R7: enabling in a project without settings writes the local file and keeps it out of git', async (t) => {
  const dir = await project(t);
  assert.equal(await enableGuard(dir), GUARD_STATUS.added);
  assert.equal(await read(local(dir)), json(withGuard({}).settings));
  assert.equal(GUARD_IGNORE, '.claude/settings.local.json');
  assert.equal(await read(join(dir, '.gitignore')), `# ${tr('gitignoreGuardHeader')}\n${GUARD_IGNORE}\n`);
});

test('R3: enabling twice leaves the very same bytes', async (t) => {
  const dir = await project(t);
  await enableGuard(dir);
  const [settings, ignore] = await Promise.all([read(local(dir)), read(join(dir, '.gitignore'))]);
  assert.equal(await enableGuard(dir), GUARD_STATUS.unchanged);
  assert.equal(await read(local(dir)), settings);
  assert.equal(await read(join(dir, '.gitignore')), ignore);
});

test('R3: the user\'s local settings are kept and the guard is merged into them', async (t) => {
  const user = { permissions: { allow: ['Bash(npm test)'] }, env: { A: '1' } };
  const dir = await project(t, JSON.stringify(user));
  assert.equal(await enableGuard(dir), GUARD_STATUS.added);
  assert.deepEqual(JSON.parse(await read(local(dir))), withGuard(user).settings);
});

test('R3, R7: a guard the user pasted by hand is not rewritten, and the file still gets out of git', async (t) => {
  const compact = JSON.stringify(withGuard({}).settings);
  const dir = await project(t, compact);
  assert.equal(await enableGuard(dir), GUARD_STATUS.unchanged);
  assert.equal(await read(local(dir)), compact);
  assert.match(await read(join(dir, '.gitignore')), /^\.claude\/settings\.local\.json$/m);
});

test('R4: a file chalc cannot read is left exactly as it was, and nothing else is written', async (t) => {
  for (const content of ['{ "permissions": ', '[]', '{"permissions": []}', '']) {
    const dir = await project(t, content);
    assert.equal(await enableGuard(dir), GUARD_STATUS.invalid, content);
    assert.equal(await disableGuard(dir), GUARD_STATUS.invalid, content);
    assert.equal(await read(local(dir)), content);
    assert.equal(existsSync(join(dir, '.gitignore')), false, content);
  }
});

test('R4: a folder in place of the settings file is not a settings file', async (t) => {
  const dir = await project(t);
  await mkdir(local(dir), { recursive: true });
  assert.equal(await enableGuard(dir), GUARD_STATUS.invalid);
  assert.equal(await disableGuard(dir), GUARD_STATUS.invalid);
});

test('R4: a .claude that is a file, not a folder, is left alone', async (t) => {
  const dir = await project(t);
  await writeFile(join(dir, '.claude'), 'x');
  assert.equal(await enableGuard(dir), GUARD_STATUS.invalid);
  assert.equal(await disableGuard(dir), GUARD_STATUS.invalid);
  assert.equal(await read(join(dir, '.claude')), 'x');
  assert.equal(existsSync(join(dir, '.gitignore')), false);
});

test('R4: a symbolic link in place of the settings file is not followed', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await project(t);
  const elsewhere = join(dir, 'elsewhere.json');
  await writeFile(elsewhere, '{}');
  await mkdir(join(dir, '.claude'));
  await symlink(elsewhere, local(dir));
  assert.equal(await enableGuard(dir), GUARD_STATUS.invalid);
  assert.equal(await read(elsewhere), '{}');
});

test('R6: the shared settings file is never created nor touched', async (t) => {
  const fresh = await project(t);
  await enableGuard(fresh);
  await disableGuard(fresh);
  assert.equal(existsSync(shared(fresh)), false);
  const dir = await project(t);
  await mkdir(join(dir, '.claude'), { recursive: true });
  await writeFile(shared(dir), '{"model":"opus"}');
  await enableGuard(dir);
  await disableGuard(dir);
  assert.equal(await read(shared(dir)), '{"model":"opus"}');
});

test('R15: disabling what chalc wrote removes the file', async (t) => {
  const dir = await project(t);
  await enableGuard(dir);
  assert.equal(await disableGuard(dir), GUARD_STATUS.removed);
  assert.equal(existsSync(local(dir)), false);
});

test('R15: disabling keeps the user\'s local settings', async (t) => {
  const user = { permissions: { allow: ['Bash(npm test)'] } };
  const dir = await project(t, JSON.stringify(user));
  await enableGuard(dir);
  assert.equal(await disableGuard(dir), GUARD_STATUS.removed);
  assert.equal(await read(local(dir)), json(user));
});

test('R15: with no file, or no guard in it, there is nothing to disable and nothing is written', async (t) => {
  assert.equal(await disableGuard(await project(t)), GUARD_STATUS.absent);
  const dir = await project(t, '{"model":"opus"}');
  assert.equal(await disableGuard(dir), GUARD_STATUS.absent);
  assert.equal(await read(local(dir)), '{"model":"opus"}');
});
