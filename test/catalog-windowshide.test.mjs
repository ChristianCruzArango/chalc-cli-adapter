// Regresión Windows (spec 020, R1): el tablero corre desacoplado y SIN consola. En Windows, cada programa de
// consola que lance (git en cada refresco de `/state.json`, cada 2 s) abría una ventana de cmd nueva, sin fin,
// mientras la página estuviera abierta. Todo proceso que lance el código emitido en `.chalc/` lleva
// `windowsHide: true`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EMITTED = ['gate', 'next', 'live'].map((dir) => join(ROOT, 'catalog', dir));
const LAUNCH = /(?<![.\w])(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\(/;

async function sources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sources(path));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(path);
  }
  return out;
}

test('R1: todo proceso que lanza el código emitido en .chalc/ va con windowsHide (sin ventanas de cmd en Windows)', async () => {
  const launches = [];
  for (const dir of EMITTED) {
    for (const file of await sources(dir)) {
      (await readFile(file, 'utf8')).split(/\r?\n/).forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('import ') || !LAUNCH.test(code)) return;
        launches.push({ at: `${relative(ROOT, file)}:${i + 1}`, hidden: /windowsHide:\s*true/.test(code) });
      });
    }
  }
  assert.ok(launches.length >= 3, 'el escaneo encuentra los lanzamientos conocidos (git, comandos del portón, servidor)');
  assert.deepEqual(launches.filter((l) => !l.hidden).map((l) => l.at), []);
});
