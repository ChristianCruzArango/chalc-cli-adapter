// spec 014 · T12 (R1, R14) — la etapa `security` dentro del portón.
//
// Corre después de `duplication`, sobre los archivos de la tarea, y un hallazgo suyo hace que el
// portón no pase. Apagarla es posible, pero nunca en silencio: la evidencia dice que se apagó.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGate } from '../catalog/gate/gate.mjs';
import { loadConfig } from '../catalog/gate/lib/config.mjs';
import { detectGateConfig } from '../lib/gatedetect.mjs';

const SECRET = 'export const apiKey = "a1b2c3d4e5f6";\n';

async function equipped(source, gateConfig = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-sec-gate-'));
  const files = {
    '.chalc/gate.json': JSON.stringify({ test: { command: 'npm test' }, language: 'es', ...gateConfig }),
    'src/api.ts': source
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

// `--fast` y un ejecutor que siempre pasa: aquí solo importa la etapa de seguridad.
const passing = async () => ({ code: 0, ms: 1 });
const runFast = (root) => runGate({ root, fast: true, run: passing, changed: ['src/api.ts'] });
const stageNames = (result) => result.stages.map((s) => s.stage);

test('R1: the security stage runs right after duplication', async () => {
  const result = await runFast(await equipped('export const total = 1;\n'));
  const names = stageNames(result);

  assert.equal(names.indexOf('security'), names.indexOf('duplication') + 1);
});

test('R1: a security finding fails the gate with file and line', async () => {
  const result = await runFast(await equipped(SECRET));
  const security = result.stages.find((s) => s.stage === 'security');

  assert.equal(security.ok, false);
  assert.deepEqual(security.findings.map((f) => [f.file, f.line, f.rule]), [['src/api.ts', 1, 'hardcoded-secret']]);
  assert.equal(result.verdict, 'fail');
  assert.equal(result.code, 1);
});

// Las supresiones viajan con la etapa para que la evidencia pueda listarlas (T13).
test('R1: suppressions travel with the stage and do not fail it', async () => {
  const text = '// chalc-allow: hardcoded-secret — clave pública de la API de mapas\nexport const apiKey = "a1b2c3d4e5f6";\n';
  const security = (await runFast(await equipped(text))).stages.find((s) => s.stage === 'security');

  assert.equal(security.ok, true);
  assert.deepEqual(security.allowed.map((a) => [a.line, a.rule]), [[2, 'hardcoded-secret']]);
});

test('R14: a disabled security stage is skipped with its reason, not dropped', async () => {
  const result = await runFast(await equipped(SECRET, { security: { enabled: false } }));
  const security = result.stages.find((s) => s.stage === 'security');

  assert.equal(security.skipped, true);
  assert.equal(security.reason, 'disabled');
  assert.equal(result.verdict, 'pass');
});

// «No aplica» sería mentira: aplica, y alguien la apagó. La evidencia dice dónde volver a encenderla.
test('R14: the evidence says the stage was disabled and where, in both languages', async () => {
  for (const [language, pattern] of [['es', /desactivada en \.chalc\/gate\.json/], ['en', /disabled in \.chalc\/gate\.json/]]) {
    const root = await equipped(SECRET, { security: { enabled: false }, language });
    await runFast(root);
    const evidence = await readFile(join(root, '.chalc/gate.md'), 'utf8');

    assert.match(evidence, pattern, language);
  }
});

// Un repo equipado antes de esta spec no trae la clave: la etapa corre igual. Apagarla tiene que ser
// una decisión escrita, no el efecto de una config vieja.
test('R14: the stage is on by default and the knob is written to gate.json', async () => {
  const root = await equipped('export const total = 1;\n');
  assert.equal((await loadConfig(root)).config.security.enabled, true);

  const detected = await detectGateConfig(root);
  assert.deepEqual(detected.security, { enabled: true });
});
