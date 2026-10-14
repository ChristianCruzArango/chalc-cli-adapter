// T10 (spec 022, R17, S9 + limpieza de hijos) — mutantes de lib/proc.mjs y cli/tools/{fs,saferead,shell,fshints}.mjs.
// Errores exactos de edit, tope de lectura en el borde, árbol de procesos y gancho de salida único.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { createFsTools } from '../cli/tools/fs.mjs';
import { writeHints } from '../cli/tools/fshints.mjs';
import { readConfinedBytes } from '../cli/tools/saferead.mjs';
import { execBounded } from '../cli/tools/shell.mjs';
import { trackChild } from '../lib/proc.mjs';

const PROC_URL = new URL('../lib/proc.mjs', import.meta.url).href;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('S9: edit distingue "no existe" de "no legible" (un directorio)', async (t) => {
  const root = await tempDir(t);
  await mkdir(join(root, 'carpeta'));
  const { edit } = createFsTools({ root });
  assert.deepEqual(await edit.run({ path: 'nada.txt', old: 'a', new: 'b' }), { path: 'nada.txt', error: 'does not exist' });
  assert.deepEqual(await edit.run({ path: 'carpeta', old: 'a', new: 'b' }), { path: 'carpeta', error: 'not a readable file' });
});

test('S9: edit que deja código incompleto devuelve el aviso (hint) junto al ok', async (t) => {
  const root = await tempDir(t);
  await writeFile(join(root, 'a.js'), 'function f() {\n  return 1;\n}\n');
  const { edit } = createFsTools({ root });
  const r = await edit.run({ path: 'a.js', old: '}\n', new: '\n' });
  assert.equal(r.ok, true);
  assert.match(r.hint, /INCOMPLETE/);
});

test('S9: un archivo de exactamente el tope se lee entero', async (t) => {
  const root = await tempDir(t);
  await writeFile(join(root, 'f.txt'), '12345');
  const r = await readConfinedBytes(root, 'f.txt', 5);
  assert.equal(r.buf.toString('utf8'), '12345');
  assert.equal((await readConfinedBytes(root, 'f.txt', 4)).buf, null);
});

test('S9: sin mapa de carpetas no se opina sobre la ubicación', async (t) => {
  const root = await tempDir(t);
  assert.deepEqual(await writeHints(join(root, 'src/app/x.js'), 'const a = 1;\n', 'src/app/x.js', { root }), {});
});

test('S9: edit avisa si el archivo queda fuera del mapa de carpetas del proyecto', async (t) => {
  const root = await tempDir(t);
  await mkdir(join(root, 'src/app/otra'), { recursive: true });
  await writeFile(join(root, 'src/app/otra/y.js'), 'const a = 1;\n');
  const { edit } = createFsTools({ root, layoutRoots: ['src/app/core'] });
  const r = await edit.run({ path: 'src/app/otra/y.js', old: 'a = 1', new: 'a = 2' });
  assert.equal(r.ok, true);
  assert.match(r.hint, /OUTSIDE the architecture folder map/);
});

test('limpieza: al vencer el plazo muere el árbol entero (también el nieto)', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await tempDir(t);
  await writeFile(join(dir, 'padre.mjs'), [
    "import { spawn } from 'node:child_process';",
    "const n = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "process.stdout.write(String(n.pid) + '\\n');",
    'setInterval(() => {}, 1000);'
  ].join('\n'));
  const r = await execBounded('node padre.mjs', { cwd: dir, timeoutMs: 800 });
  const pid = Number(r.stdout.trim());
  assert.equal(r.timedOut, true);
  assert.ok(pid > 0);
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* ya muerto */ } });
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((res) => setTimeout(res, 50));
  assert.equal(alive(pid), false, 'el nieto sigue vivo');
});

test('limpieza: el gancho de salida se registra una sola vez', () => {
  const before = process.listenerCount('exit');
  const fake = () => { const listeners = {}; return { pid: 0, on: (ev, fn) => { listeners[ev] = fn; }, emit: (ev) => listeners[ev]?.() }; };
  const a = trackChild(fake()); const b = trackChild(fake());
  assert.ok(process.listenerCount('exit') - before <= 1);
  a.emit('exit'); b.emit('exit');
  trackChild(fake()).emit('exit');
  assert.ok(process.listenerCount('exit') - before <= 1);
});

test('limpieza: al salir el proceso, mata los hijos rastreados', { skip: process.platform === 'win32' }, async () => {
  const script = [
    "import { spawn } from 'node:child_process';",
    `import { trackChild } from ${JSON.stringify(PROC_URL)};`,
    "const c = trackChild(spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true }));",
    "process.stdout.write(String(c.pid));",
    'process.exit(0);'
  ].join('\n');
  const pid = Number(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.ok(pid > 0);
  try {
    for (let i = 0; i < 40 && alive(pid); i++) await new Promise((res) => setTimeout(res, 50));
    assert.equal(alive(pid), false, 'el hijo rastreado sobrevivió a la salida');
  } finally { try { process.kill(pid, 'SIGKILL'); } catch { /* ya muerto */ } }
});
