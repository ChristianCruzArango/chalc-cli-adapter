// T39 (spec 016, R39) — de extremo a extremo y por TODA la superficie de comandos que se puede ejecutar
// sin efectos: `--lang X` produce exactamente la misma salida que `CHALC_LANG=X` partiendo del idioma
// contrario. Si algún comando ignorase `--lang`, su salida diferiría.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
const HOME = mkdtempSync(join(tmpdir(), 'chalc-t39home-'));   // sin config guardada del usuario
const WORK = mkdtempSync(join(tmpdir(), 'chalc-t39work-'));
mkdirSync(join(WORK, 'app'));
writeFileSync(join(WORK, 'app', 'package.json'), JSON.stringify({ name: 'demo', dependencies: { '@angular/core': '17' } }));

// Comandos SIN efectos: ayuda, errores de uso, simulaciones (--dry-run) y lecturas.
const SURFACE = [
  ['--help'],
  ['--no-such-flag'],
  ['doctor', '--yes'],
  ['inspect', join(WORK, 'app')],
  ['tokens', join(WORK, 'app')],
  [join(WORK, 'app'), '--dry-run', '--yes', '--target', 'claude', '--method', 'sdd'],
  ['init', '--stack', 'angular', '--name', 'demo', '--dir', WORK, '--dry-run', '--yes'],
  ['feature', '--dry-run'],
  ['update', '--dry-run'],
  ['lang', '--dry-run'],
  ['qa', '--dry-run'],
  ['dashboard', '--dry-run'],
  ['spec', '--dry-run']
];

const run = (args, env) => {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8', cwd: WORK, input: '', timeout: 30000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LANG: 'C', LC_ALL: '', ...env }
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

for (const args of SURFACE) {
  test(`R39: "${args.join(' ')}" — --lang drives the interface like CHALC_LANG`, { timeout: 60000 }, () => {
    for (const [target, opposite] of [['en', 'es'], ['es', 'en']]) {
      const viaFlag = run([...args, '--lang', target], { CHALC_LANG: opposite });
      const viaEnv = run(args, { CHALC_LANG: target });
      assert.equal(viaFlag.code, viaEnv.code, `${target}: código`);
      assert.equal(viaFlag.out, viaEnv.out, `${target}: salida`);
    }
    assert.notEqual(run(args, { CHALC_LANG: 'es' }).out, run(args, { CHALC_LANG: 'en' }).out, 'el comando muestra texto traducido');
  });
}

// El segundo ejecutable (chalc-cli, la TUI del agente): sin IA configurada termina con un mensaje traducido.
test('R39: chalc-cli (agent TUI) also follows --lang', { timeout: 60000 }, () => {
  const CLI = fileURLToPath(new URL('../cli/index.mjs', import.meta.url));
  const runCli = (args, env) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: WORK, input: '', timeout: 30000, env: { ...process.env, HOME, USERPROFILE: HOME, LANG: 'C', LC_ALL: '', ...env } });
    return `${r.status}|${r.stdout}|${r.stderr}`;
  };
  for (const [target, opposite] of [['en', 'es'], ['es', 'en']]) {
    assert.equal(runCli(['--lang', target], { CHALC_LANG: opposite }), runCli([], { CHALC_LANG: target }), target);
  }
  assert.notEqual(runCli([], { CHALC_LANG: 'es' }), runCli([], { CHALC_LANG: 'en' }));
});
