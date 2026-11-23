// Spec 027 (arranque limpio), T1 — el portón y el advisor hablan el idioma del proyecto (R10, R11). Equipar con
// `--lang` dejaba `"language": ""` en `.chalc/gate.json`, y el advisor caía al inglés en un proyecto en español.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/tmpdir.mjs';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
// La interfaz en el idioma CONTRARIO al que se pide: el del portón tiene que salir del flag o del manifiesto.
const run = (args, cwd, ui) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', input: '', timeout: 60000, env: { ...process.env, CHALC_LANG: ui } });
const gateLanguage = (dir) => JSON.parse(readFileSync(join(dir, '.chalc', 'gate.json'), 'utf8')).language;

async function project(t, manifest) {
  const dir = await tempDir(t, 'chalc-027-lang-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --version' } }));
  if (manifest) await writeFile(join(dir, '.chalc.json'), JSON.stringify(manifest));
  return dir;
}

for (const [lang, ui] of [['es', 'en'], ['en', 'es']]) {
  test(`R10: equipar con --lang ${lang} deja ese idioma en gate.json (interfaz en ${ui})`, async (t) => {
    const dir = await project(t);
    const r = run([dir, '--yes', '--target', 'claude', '--lang', lang], dir, ui);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(gateLanguage(dir), lang);
  });
}

test('R11: re-equipar sin --lang conserva el idioma que guarda el manifiesto', async (t) => {
  const dir = await project(t, { target: 'claude', lang: 'es', stacks: [], skills: [], mcp: [], methods: [] });
  const r = run([dir, '--yes', '--target', 'claude'], dir, 'en');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(gateLanguage(dir), 'es');
});

test('R10: sin --lang ni manifiesto, el portón toma el idioma de la interfaz', async (t) => {
  const dir = await project(t);
  assert.equal(run([dir, '--yes', '--target', 'claude'], dir, 'es').status, 0);
  assert.equal(gateLanguage(dir), 'es');
});
