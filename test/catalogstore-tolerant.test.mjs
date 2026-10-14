// T8 (spec 022, R9, F9) — un JSON corrupto en ~/.chalc/rules/ no tumba los comandos: se avisa y se omite,
// con la misma lectura tolerante que usa `doctor` (política de lib/userdata.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { t } from '../lib/i18n.mjs';

function captureWarn(t) {
  const lines = [];
  const original = console.warn;
  console.warn = (...a) => lines.push(a.join(' '));
  t.after(() => { console.warn = original; });
  return lines;
}

test('F9: loadJsonDir omite el JSON roto, avisa con su ruta y devuelve los válidos', async (tt) => {
  const { loadJsonDir } = await import('../lib/commands/catalogstore.mjs');
  const dir = await tempDir(tt);
  await writeFile(join(dir, 'ok.json'), '{"id":"ok"}');
  await writeFile(join(dir, 'roto.json'), '{ no es json');
  const warns = captureWarn(tt);
  assert.deepEqual(await loadJsonDir(dir), [{ id: 'ok' }]);
  assert.equal(warns.length, 1);
  assert.ok(warns[0].includes(join(dir, 'roto.json')), warns[0]);
  assert.notEqual(t('catalogJsonSkipped', 'p', 'm'), 'catalogJsonSkipped', 'el aviso pasa por t()');
});

test('F9: una regla del usuario ilegible no impide cargar las demás reglas', async (tt) => {
  const home = await tempDir(tt);
  const prev = process.env.CHALC_HOME;
  process.env.CHALC_HOME = home;
  tt.after(() => { if (prev === undefined) delete process.env.CHALC_HOME; else process.env.CHALC_HOME = prev; });
  await mkdir(join(home, 'rules'), { recursive: true });
  await writeFile(join(home, 'rules', 'roto.json'), '{');
  await writeFile(join(home, 'rules', 'mia.json'), '{"id":"zz-mia-g8"}');
  captureWarn(tt);
  const { loadRules } = await import('../lib/commands/catalogstore.mjs');
  const rules = await loadRules();
  assert.ok(rules.some((r) => r.id === 'zz-mia-g8'));
  assert.ok(rules.length > 1, 'las reglas del paquete siguen cargando');
});

test('F9: el mismo archivo roto se avisa una sola vez por proceso', async (tt) => {
  const { loadJsonDir } = await import('../lib/commands/catalogstore.mjs');
  const dir = await tempDir(tt);
  await writeFile(join(dir, 'roto.json'), '[');
  const warns = captureWarn(tt);
  assert.deepEqual(await loadJsonDir(dir), []);
  assert.deepEqual(await loadJsonDir(dir), []);
  assert.equal(warns.length, 1);
});
