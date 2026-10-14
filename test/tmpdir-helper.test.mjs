// T8 (spec 022, R20, 5.3) — los tests limpian sus temporales: `tempDir(t)` registra el borrado en `t.after`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir, withTempDir } from './helpers/tmpdir.mjs';

test('5.3: tempDir crea una carpeta que existe durante el test y se borra al terminar', async (t) => {
  let dir = '';
  await t.test('uso', async (st) => {
    dir = await tempDir(st, 'chalc-helper-');
    assert.ok(existsSync(dir));
    assert.match(dir, /chalc-helper-/);
    await writeFile(join(dir, 'f.txt'), 'x');
  });
  assert.ok(dir && !existsSync(dir), 'la carpeta debe borrarse tras el test');
});

test('5.3: withTempDir pasa la carpeta a fn, devuelve su resultado y la borra al terminar', async (t) => {
  let dir = '';
  await t.test('uso', async (st) => {
    const out = await withTempDir(st, async (d) => { dir = d; assert.ok(existsSync(d)); return 42; });
    assert.equal(out, 42);
  });
  assert.ok(dir && !existsSync(dir));
});
