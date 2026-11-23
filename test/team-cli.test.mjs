// Spec 032 (estado de equipo), T5 — `node .chalc/team.mjs` (R1, R8, R9, R10): lo que usan el orquestador y los
// roles para registrar, y el usuario para ver. Los valores van como `clave=valor`, sin JSON ni comillas raras.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { main, parsePairs } from '../catalog/team/team.mjs';
import { readLedger } from '../catalog/team/lib/ledger.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const S = 'specs/027-checkout';
async function repo(t, language = 'es') {
  const root = await tempDir(t, 'chalc-032-cli-');
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ language }));
  return root;
}
const run = async (root, ...args) => { const lines = []; return { code: await main({ argv: ['node', 'team.mjs', ...args], cwd: root, write: (l) => lines.push(l) }), text: lines.join('\n') }; };
const seed = async (root) => {
  assert.equal((await run(root, 'event', 'feature_opened', 'feature=pagos', 'agent=claude')).code, 0);
  assert.equal((await run(root, 'event', 'spec_added', 'feature=pagos', `spec=${S}`)).code, 0);
};

test('los pares clave=valor: texto, números, booleanos, y el = dentro del valor', () => {
  assert.deepEqual(parsePairs(['spec=specs/027', 'wave=2', 'ok=false', 'fast=true', 'task=3 de 7', 'command=node x --a=b', 'score=71.5', 'head=0123']),
    { spec: 'specs/027', wave: 2, ok: false, fast: true, task: '3 de 7', command: 'node x --a=b', score: 71.5, head: '0123' });
  assert.deepEqual(parsePairs(['sin-igual', '=vacío', '--root', 'x']), {});
});

test('R1: `event` registra en el repo, y el siguiente `status` lo muestra', async (t) => {
  const root = await repo(t);
  await seed(root);
  assert.deepEqual((await readLedger(root)).map((e) => e.type), ['feature_opened', 'spec_added']);
  const status = await run(root, 'status');
  assert.equal(status.code, 0);
  assert.ok(status.text.includes('pagos') && status.text.includes(S) && status.text.includes(TEXT.es.state.draft));
  assert.ok(existsSync(join(root, '.chalc', 'team', 'status.json')));
});

test('R3: un evento que no vale sale con 1, dice por qué y no escribe', async (t) => {
  const root = await repo(t);
  const out = await run(root, 'event', 'blocked', `spec=${S}`);
  assert.equal(out.code, 1);
  assert.ok(out.text.includes('reason'));
  assert.deepEqual(await readLedger(root), []);
  assert.equal((await run(root, 'event', 'inventado', 'x=1')).code, 1);
  assert.equal((await run(root, 'event')).code, 1);
});

test('R9: `block` registra el bloqueo con su motivo; sin motivo o sin spec se niega', async (t) => {
  const root = await repo(t);
  await seed(root);
  assert.equal((await run(root, 'block', '--spec', S, 'falta la clave del API')).code, 0);
  assert.deepEqual((await readLedger(root)).at(-1).reason, 'falta la clave del API');
  assert.equal((await run(root, 'block', '--spec', S)).code, 1);
  assert.equal((await run(root, 'block', 'solo motivo')).code, 1);
  assert.equal((await readLedger(root)).length, 3);
});

test('R8: `status` sale en el idioma del proyecto, y sin nada registrado lo dice', async (t) => {
  assert.ok((await run(await repo(t, 'en'), 'status')).text.includes(TEXT.en.empty));
  assert.ok((await run(await repo(t, 'es'), 'status')).text.includes(TEXT.es.empty));
});

test('R10: `report --feature` escribe el informe; sin feature se niega', async (t) => {
  const root = await repo(t);
  await seed(root);
  const report = await run(root, 'report', '--feature', 'pagos');
  assert.equal(report.code, 0);
  assert.ok(report.text.includes(TEXT.es.report.title('pagos')) && report.text.includes(TEXT.es.report.unverified));
  assert.equal((await run(root, 'report')).code, 1);
});

test('R2: --root escribe en la raíz indicada', async (t) => {
  const here = await repo(t);
  const other = await repo(t);
  await run(here, 'event', 'feature_opened', 'feature=pagos', 'agent=claude', '--root', other);
  assert.equal((await readLedger(other)).length, 1);
  assert.deepEqual(await readLedger(here), []);
});

test('un comando desconocido, o ninguno, muestra el uso y sale con 1', async (t) => {
  const root = await repo(t);
  for (const args of [[], ['inventado']]) {
    const out = await run(root, ...args);
    assert.equal(out.code, 1);
    assert.ok(out.text.includes('status') && out.text.includes('report') && out.text.includes('block'));
  }
});
