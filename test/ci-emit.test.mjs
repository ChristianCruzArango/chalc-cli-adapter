// Spec 029 (hooks, integridad y CI), T6 — la misma comprobación fuera de la máquina (R10, R11, R12). Solo si se
// pide con `--ci`: un workflow se ejecuta solo y va commiteado, así que chalc no lo impone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/tmpdir.mjs';
import { coherentSpec } from './helpers/coherentspec.mjs';
import { CI_WORKFLOW_REL, emitCi } from '../lib/ciemit.mjs';
import { equipForSpec } from '../lib/commands/equip.mjs';
import { main } from '../catalog/gate/gate.mjs';
import { parseArgs } from '../lib/args.mjs';
import { MANAGED_MARK } from '../lib/targetkit/formats.mjs';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
const at = (dir, rel) => join(dir, ...rel.split('/'));
async function project(t) {
  const dir = await tempDir(t, 'chalc-029-ci-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --version' } }));
  return dir;
}
const put = async (dir, files) => { for (const [rel, content] of Object.entries(files)) { await mkdir(dirname(at(dir, rel)), { recursive: true }); await writeFile(at(dir, rel), content); } };
const ci = async (dir) => { const lines = []; return { code: await main({ argv: ['node', 'gate.mjs', '--ci'], root: dir, write: (l) => lines.push(l) }), text: lines.join('\n') }; };

test('R10: el workflow corre `node .chalc/gate.mjs --ci` en push y pull request, con permisos de solo lectura', async (t) => {
  const dir = await project(t);
  assert.equal(CI_WORKFLOW_REL, '.github/workflows/chalc.yml');
  assert.equal(await emitCi(dir), CI_WORKFLOW_REL);
  const yml = await readFile(at(dir, CI_WORKFLOW_REL), 'utf8');
  assert.ok(yml.includes(MANAGED_MARK));
  assert.match(yml, /^on: \[push, pull_request\]$/m);
  assert.match(yml, /^permissions:\n {2}contents: read$/m);
  assert.match(yml, /run: node \.chalc\/gate\.mjs --ci$/m);
  assert.doesNotMatch(yml, /pull_request_target|secrets\./, 'ni disparadores con permisos de más ni secretos');
  assert.equal(yml.includes('\t'), false);
});

test('R12: un workflow del usuario con ese nombre se respalda; el de chalc se reemplaza sin más', async (t) => {
  const dir = await project(t);
  await put(dir, { [CI_WORKFLOW_REL]: 'name: mío\n' });
  await emitCi(dir);
  assert.ok((await readFile(at(dir, CI_WORKFLOW_REL), 'utf8')).includes(MANAGED_MARK));
  const backups = join(dir, '.chalc', 'backups', '.github', 'workflows');
  assert.equal(readdirSync(backups).length, 1, 'el del usuario quedó respaldado');
  await emitCi(dir);
  assert.equal(readdirSync(backups).length, 1, 'el de chalc no se respalda');
});

test('R10: sin --ci equipar no escribe ningún workflow; con --ci, sí', async (t) => {
  const dir = await project(t);
  const run = (args) => spawnSync(process.execPath, [BIN, dir, '--yes', '--target', 'claude', ...args], { cwd: dir, encoding: 'utf8', input: '', timeout: 60000, env: { ...process.env, CHALC_LANG: 'es' } });
  assert.equal(run([]).status, 0);
  assert.equal(existsSync(at(dir, CI_WORKFLOW_REL)), false);
  const withCi = run(['--ci']);
  assert.equal(withCi.status, 0, withCi.stdout + withCi.stderr);
  assert.ok(existsSync(at(dir, CI_WORKFLOW_REL)));
  assert.equal(parseArgs(['--ci']).flags.ci, true);
});

test('R10: en dry-run con --ci el plan lo anuncia y no escribe nada', async (t) => {
  const dir = await project(t);
  const r = spawnSync(process.execPath, [BIN, dir, '--yes', '--target', 'claude', '--ci', '--dry-run'], { cwd: dir, encoding: 'utf8', input: '', timeout: 60000, env: { ...process.env, CHALC_LANG: 'es' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(CI_WORKFLOW_REL));
  assert.equal(existsSync(at(dir, CI_WORKFLOW_REL)), false);
});

test('R11: `gate.mjs --ci` pasa con el tooling íntegro y la spec coherente y aprobada, sin correr tests', async (t) => {
  const dir = await project(t);
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  await put(dir, coherentSpec('specs/001-demo'));
  const out = await ci(dir);
  assert.equal(out.code, 0, out.text);
  assert.equal(existsSync(at(dir, '.chalc/gate.md')), false, 'no es una corrida del portón: no deja evidencia');
});

test('R11: `gate.mjs --ci` falla con una herramienta alterada, con la spec incoherente o sin aprobar', async (t) => {
  const altered = await project(t);
  await equipForSpec(altered, 'lite', 'claude', { specLang: 'es' });
  await put(altered, coherentSpec('specs/001-demo'));
  await appendFile(at(altered, '.chalc/gate/lib/mutation.mjs'), '\n// tocado\n');
  const a = await ci(altered);
  assert.equal(a.code, 1);
  assert.ok(a.text.includes('.chalc/gate/lib/mutation.mjs'));

  const unapproved = await project(t);
  await equipForSpec(unapproved, 'lite', 'claude', { specLang: 'es' });
  await put(unapproved, coherentSpec('specs/001-demo', { sealed: false }));
  const u = await ci(unapproved);
  assert.equal(u.code, 1);
  assert.ok(u.text.includes('--approve-spec'));

  const broken = await project(t);
  await equipForSpec(broken, 'lite', 'claude', { specLang: 'es' });
  const files = coherentSpec('specs/001-demo');
  delete files['specs/001-demo/plan.md'];
  await put(broken, files);
  const b = await ci(broken);
  assert.equal(b.code, 1);
  assert.ok(b.text.includes('specs/001-demo/plan.md'));
});

test('R11: sin ninguna spec, `gate.mjs --ci` solo comprueba el tooling', async (t) => {
  const dir = await project(t);
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  assert.equal((await ci(dir)).code, 0);
});
