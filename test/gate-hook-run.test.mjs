// Spec 029 (hooks, integridad y CI), T3 — lo que hacen los hooks de git (R4, R5). `pre-commit` corre el portón
// rápido solo si el commit lleva código; `pre-push` no corre nada: exige que el código cambiado ya esté medido.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runHook } from '../catalog/gate/lib/hook.mjs';
import { FRAME } from '../catalog/gate/lib/i18n.mjs';

const STATE = { verdict: 'pass', fast: false, scopeHash: 'h', scope: { files: ['src/a.ts'] } };
// Todo lo que el hook mira del mundo, inyectado: nada de git ni de portón de verdad.
function world(over = {}) {
  const calls = [];
  const lines = [];
  const io = {
    lang: 'es',
    staged: async () => over.staged ?? ['src/a.ts'],
    scope: async () => ({ files: over.changed ?? ['src/a.ts'], undetermined: Boolean(over.undetermined) }),
    state: async () => (over.state === undefined ? STATE : over.state),
    hashOf: async (files) => { calls.push(['hash', files]); return over.currentHash ?? 'h'; },
    fastGate: async () => { calls.push(['gate']); return over.gateCode ?? 0; },
    write: (line) => lines.push(line)
  };
  return { io, calls, lines };
}
const hook = async (name, over) => { const w = world(over); return { code: await runHook(name, w.io), ...w }; };

test('R4: pre-commit sin código en el commit sale con 0 y no corre nada', async () => {
  // Las herramientas de `.chalc/` son `.mjs`, pero no son código del proyecto: commitearlas no es «llevar código».
  for (const staged of [[], ['README.md', 'specs/001-x/spec.md', '.chalc/gate.json', 'docs/a.png'], ['.chalc/gate/gate.mjs', '.chalc/next/lib/decide.mjs']]) {
    const out = await hook('pre-commit', { staged });
    assert.deepEqual([out.code, out.calls], [0, []], JSON.stringify(staged));
  }
});

test('R4: pre-commit con código en el commit corre el portón rápido y sale con su código', async () => {
  assert.deepEqual((await hook('pre-commit', { staged: ['README.md', 'src/a.ts'] })).calls, [['gate']]);
  assert.equal((await hook('pre-commit', { gateCode: 0 })).code, 0);
  assert.equal((await hook('pre-commit', { gateCode: 1 })).code, 1);
  assert.deepEqual((await hook('pre-commit', { staged: ['test/a.test.mjs'] })).calls, [['gate']], 'un test también es código');
});

test('R5: pre-push sin código cambiado sale con 0', async () => {
  const out = await hook('pre-push', { changed: [], state: null });
  assert.deepEqual([out.code, out.calls], [0, []]);
});

test('R5: pre-push con el código medido por una corrida completa que aprueba sale con 0, sin correr el portón', async () => {
  const out = await hook('pre-push');
  assert.equal(out.code, 0);
  assert.deepEqual(out.calls, [['hash', ['src/a.ts']]]);
});

test('R5: pre-push se niega si falta la evidencia, no aprueba, es --fast, o el código cambió después', async () => {
  const cases = [
    { state: null },
    { state: { ...STATE, verdict: 'fail' } },
    { state: { ...STATE, verdict: 'blocked' } },
    { state: { ...STATE, fast: true } },
    { state: { verdict: 'pass', scopeHash: 'h', scope: { files: ['src/a.ts'] } } },
    { currentHash: 'otro' },
    { state: { ...STATE, scopeHash: '' } },
    { changed: ['src/a.ts', 'src/nuevo.ts'] },
    { undetermined: true }
  ];
  for (const over of cases) {
    const out = await hook('pre-push', over);
    assert.equal(out.code, 1, JSON.stringify(over));
    assert.ok(out.lines.join('\n').includes('node .chalc/gate.mjs'), 'dice qué correr');
    assert.equal(out.calls.some(([what]) => what === 'gate'), false, 'nunca corre el portón desde el hook');
  }
});

test('R5: pre-push acepta que la evidencia midiera MÁS archivos que los que ahora cambian', async () => {
  const out = await hook('pre-push', { changed: ['src/a.ts'], state: { ...STATE, scope: { files: ['src/a.ts', 'src/b.ts'] } } });
  assert.equal(out.code, 0);
});

test('un hook que chalc no conoce no bloquea nada', async () => {
  const out = await hook('post-merge');
  assert.deepEqual([out.code, out.calls], [0, []]);
});

test('R5: el aviso de pre-push existe en es y en, y dice que saltarlo es decisión de una persona', () => {
  for (const lang of ['es', 'en']) {
    assert.match(FRAME[lang].hook.unmeasured, /--no-verify/, lang);
    assert.match(FRAME[lang].hook.unmeasured, /node \.chalc\/gate\.mjs/, lang);
  }
});

// ── con git de verdad ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { main } from '../catalog/gate/gate.mjs';
import { stagedFiles } from '../catalog/gate/lib/changed.mjs';
import { sealBaseline } from '../catalog/gate/lib/baseline.mjs';

const git = (args, cwd) => spawnSync('git', ['-c', 'user.name=chalc', '-c', 'user.email=test@chalc.dev', ...args], { cwd, encoding: 'utf8' });
async function repo(t) {
  const dir = await tempDir(t, 'chalc-029-hook-');
  await mkdir(join(dir, '.chalc'));
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ test: { command: 'node --version' }, mutation: { required: false }, spec: { dir: 'specs' }, language: 'es' }));
  await writeFile(join(dir, 'README.md'), '# demo\n');
  assert.equal(git(['init', '-q'], dir).status, 0);
  git(['add', '-A'], dir);
  assert.equal(git(['commit', '-q', '-m', 'base'], dir).status, 0);
  return dir;
}
const hookOf = (dir, name) => main({ argv: ['node', 'gate.mjs', '--hook', name], root: dir, write: () => {} });

test('R4: stagedFiles lista lo que entra en el commit, con rutas con espacios y sin lo borrado', async (t) => {
  const dir = await repo(t);
  await writeFile(join(dir, 'src', 'con espacio.ts'), 'export const a = 1;\n');
  await writeFile(join(dir, 'sin-añadir.ts'), 'export const b = 1;\n');
  git(['rm', '-q', '--cached', 'README.md'], dir);
  git(['add', 'src'], dir);
  assert.deepEqual(await stagedFiles(dir), ['src/con espacio.ts']);
  assert.deepEqual(await stagedFiles(await tempDir(t, 'chalc-029-hook-')), [], 'sin repo no hay nada en el índice');
});

test('R4: `gate.mjs --hook pre-commit` con solo documentación no corre el portón', async (t) => {
  const dir = await repo(t);
  await writeFile(join(dir, 'README.md'), '# demo\nmás texto\n');
  git(['add', 'README.md'], dir);
  assert.equal(await hookOf(dir, 'pre-commit'), 0);
  assert.equal(existsSync(join(dir, '.chalc', 'gate.md')), false);
});

test('R4: `gate.mjs --hook pre-commit` con código en el commit corre el portón rápido', async (t) => {
  const dir = await repo(t);
  await writeFile(join(dir, 'src', 'a.mjs'), 'export const a = () => 1;\n');
  git(['add', 'src'], dir);
  assert.equal(await hookOf(dir, 'pre-commit'), 0);
  assert.ok(existsSync(join(dir, '.chalc', 'gate.md')), 'dejó su evidencia');
});

test('R5: `gate.mjs --hook pre-push` se niega con código sin medir y deja pasar si no hay cambios', async (t) => {
  const dir = await repo(t);
  assert.equal(await hookOf(dir, 'pre-push'), 0);
  // La línea base que deja el portón al cerrar una tarea: «lo cambiado» se mide desde ahí.
  await sealBaseline(dir, { commit: git(['rev-parse', 'HEAD'], dir).stdout.trim(), config: null });
  await writeFile(join(dir, 'src', 'a.mjs'), 'export const a = () => 1;\n');
  git(['add', 'src'], dir);
  git(['commit', '-q', '-m', 'código', '--no-verify'], dir);
  assert.equal(await hookOf(dir, 'pre-push'), 1);
  assert.equal(await hookOf(dir, 'otro-hook'), 0);
});
