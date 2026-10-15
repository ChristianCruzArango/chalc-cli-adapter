// T10 (spec 023, R5, R8, R9, R14, R15) — `chalc` (apply) activa o quita la guarda SOLO con el flag.
//
// `apply` re-equipa a menudo: no pregunta nunca por la guarda (eso es de `init`, R13). Sin flag no toca los
// ajustes del asistente (R5, como `gate-hook.test.mjs`); `--guard` los escribe, `--no-guard` quita lo de chalc,
// y en dry-run la guarda es una línea más del plan. Se lanza el CLI de verdad: `apply` lee argv al importarse.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/tmpdir.mjs';
import { lang, t as tr } from '../lib/i18n.mjs';
import { GUARD_ASK } from '../lib/guardsettings.mjs';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
const local = (dir) => join(dir, '.claude', 'settings.local.json');

// Un proyecto vacío y un catálogo de usuario propio, para no leer ni escribir el `~/.chalc` de la máquina.
async function setup(t) {
  const base = await tempDir(t, 'chalc-guard-apply-');
  const proj = join(base, 'proj');
  await mkdir(proj);
  return { proj, home: join(base, 'home') };
}

function chalc({ proj, home }, ...args) {
  const env = { ...process.env, CHALC_HOME: home, CHALC_LANG: lang };
  const r = spawnSync(process.execPath, [BIN, proj, '--yes', ...args], { env, encoding: 'utf8', input: '', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
}

test('R5: equipping without the flag writes no assistant settings and says nothing about the guard', async (t) => {
  const ctx = await setup(t);
  const out = chalc(ctx, '--target', 'claude');
  assert.equal(existsSync(join(ctx.proj, '.chalc.json')), true);
  assert.equal(existsSync(local(ctx.proj)), false);
  assert.equal(existsSync(join(ctx.proj, '.claude', 'settings.json')), false);
  assert.doesNotMatch(out, /settings\.local\.json/);
});

test('R14, R15: --guard enables it and --no-guard removes it again', async (t) => {
  const ctx = await setup(t);
  assert.ok(chalc(ctx, '--target', 'claude', '--guard').includes(tr('guardAdded')));
  const settings = JSON.parse(await readFile(local(ctx.proj), 'utf8'));
  assert.deepEqual(settings.permissions.ask, [...GUARD_ASK]);
  assert.match(await readFile(join(ctx.proj, '.gitignore'), 'utf8'), /^\.claude\/settings\.local\.json$/m);
  assert.ok(chalc(ctx, '--target', 'claude', '--no-guard').includes(tr('guardRemoved')));
  assert.equal(existsSync(local(ctx.proj)), false);
});

test('R8: the dry-run lists the guard in the plan and writes nothing', async (t) => {
  const ctx = await setup(t);
  assert.ok(chalc(ctx, '--target', 'claude', '--guard', '--dry-run').includes(tr('guardDryAdd')));
  assert.equal(existsSync(local(ctx.proj)), false);
  assert.equal(existsSync(join(ctx.proj, '.chalc.json')), false);
});

test('R9: with another assistant --guard only warns', async (t) => {
  const ctx = await setup(t);
  assert.ok(chalc(ctx, '--target', 'codex', '--guard').includes(tr('guardOnlyClaude', 'codex')));
  assert.equal(existsSync(join(ctx.proj, '.claude')), false);
});
