// T11 (spec 023, R5, R8, R9, R13, R14) — `chalc init` y la guarda de commit y push.
//
// `init` resuelve la guarda junto al asistente: la pregunta en interactivo (con «sí» por defecto, probada en
// `guardstep.test.mjs`) o el flag. En dry-run es una línea más de lo que «se haría»; al crear, se aplica sobre
// el proyecto ya equipado. El CLI real corre sin IA (`--architecture`, `--no-ai`); para crear de verdad, un
// `npx` falso en el PATH hace de scaffolder y solo crea la carpeta, sin red.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/tmpdir.mjs';
import { envValue } from './helpers/envkey.mjs';
import { printInitGuard } from '../lib/commands/init.mjs';
import { lang, t as tr } from '../lib/i18n.mjs';
import { c } from '../lib/ansi.mjs';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
const local = (dir) => join(dir, '.claude', 'settings.local.json');

async function printed(dest, step) {
  const lines = [];
  await printInitGuard(dest, step, (line) => lines.push(line));
  return lines;
}

// ── printInitGuard ────────────────────────────────────────────────────────────────────────────────

test('R13, R14: on the created project the guard is applied and reported with its own mark', async (t) => {
  const dest = await tempDir(t, 'chalc-guard-init-');
  assert.deepEqual(await printed(dest, { want: true, targetName: 'claude', dryRun: false }), [`  ${c.cyan('•')} ${tr('guardAdded')}`]);
  assert.ok(existsSync(local(dest)));
});

test('R8: in the dry-run it is one more line of what would be done, and nothing is written', async (t) => {
  const dest = await tempDir(t, 'chalc-guard-init-');
  assert.deepEqual(await printed(dest, { want: true, targetName: 'claude', dryRun: true }), [c.dim(`  ▶ ${tr('guardDryAdd')}`)]);
  assert.equal(existsSync(join(dest, '.claude')), false);
});

test('R5: when nothing was asked for, nothing is printed', async (t) => {
  const dest = await tempDir(t, 'chalc-guard-init-');
  assert.deepEqual(await printed(dest, { want: null, targetName: 'claude', dryRun: false }), []);
  assert.equal(existsSync(join(dest, '.claude')), false);
});

// ── chalc init --dry-run ──────────────────────────────────────────────────────────────────────────

async function initDry(t, ...args) {
  const base = await tempDir(t, 'chalc-guard-init-');
  const env = { ...process.env, CHALC_HOME: join(base, '.home'), CHALC_LANG: lang };
  const argv = [BIN, 'init', 'angular', 'demo', '--architecture', 'modular-clean-architecture', '--no-ai', '--dry-run', '--yes', '--dir', base, ...args];
  const r = spawnSync(process.execPath, argv, { env, encoding: 'utf8', input: '', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.deepEqual((await readdir(base)).filter((name) => name !== '.home'), [], 'el dry-run no crea nada');
  return r.stdout;
}

test('R8, R14: init --guard --dry-run lists the guard among what it would do', async (t) => {
  assert.ok((await initDry(t, '--guard')).includes(tr('guardDryAdd')));
});

test('R5: init without the flag and without a terminal leaves the guard out', async (t) => {
  assert.doesNotMatch(await initDry(t), /settings\.local\.json/);
});

test('R9: init --guard with another assistant only warns', async (t) => {
  assert.ok((await initDry(t, '--guard', '--target', 'codex')).includes(tr('guardOnlyClaude', 'codex')));
});

// ── chalc init (crear) ────────────────────────────────────────────────────────────────────────────

// Un script de shell con bit de ejecución: en Windows `npx` es `npx.cmd` y pasa por cmd.exe (reglas 3 y 7).
test('R13, R14: init --guard creates the project, equips it and enables the guard on it', { skip: process.platform === 'win32' }, async (t) => {
  const base = await tempDir(t, 'chalc-guard-init-');
  const bin = join(base, '.bin');
  await mkdir(bin);
  await writeFile(join(bin, 'npx'), '#!/bin/sh\nmkdir "$4"\n', { mode: 0o755 });
  const env = { ...process.env, CHALC_HOME: join(base, '.home'), CHALC_LANG: lang, PATH: `${bin}${delimiter}${envValue(process.env, 'PATH')}` };
  const argv = [BIN, 'init', 'angular', 'demo', '--architecture', 'modular-clean-architecture', '--no-ai', '--yes', '--allow-exec', '--dir', base, '--guard'];
  const r = spawnSync(process.execPath, argv, { env, encoding: 'utf8', input: '', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(r.stdout.includes(tr('guardAdded')), r.stdout);
  const dest = join(base, 'demo');
  assert.ok(existsSync(local(dest)));
  assert.match(await readFile(join(dest, '.gitignore'), 'utf8'), /^\.claude\/settings\.local\.json$/m);
});
