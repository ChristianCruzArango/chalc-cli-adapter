// T14 (spec 022, R17, S9) — `chalc install` con credenciales en la URL las rechaza SIN mostrarlas: la
// cabecera del comando imprimía la fuente cruda (`usuario:secreto@…`) antes de validarla. Hallado en el E2E.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/tmpdir.mjs';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));

test('S9: la URL con credenciales no aparece en la salida de chalc install', async (t) => {
  const home = await tempDir(t);
  const r = spawnSync(process.execPath, [BIN, 'install', 'https://usuario:secreto123@gitlab.example.com/x/skill.git', '--allow-exec', '--yes'], {
    env: { ...process.env, CHALC_HOME: home, CHALC_LANG: 'es' }, encoding: 'utf8', timeout: 20000
  });
  const out = r.stdout + r.stderr;
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(out, /secreto123/);
  assert.doesNotMatch(out, /usuario:/);
  assert.match(out, /gitlab\.example\.com/);   // la fuente se sigue mostrando, sin el secreto
});
