// Spec 041 (superficies sin interfaz), T4 — la entrega de una spec de API o de CLI (R7): no entra sin un
// resultado de sus sondas, sin fallos, sobre ESE código.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { commitAll, git, gitRepo, passGate, specFiles, team, writeFiles } from './helpers/teamrepo.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const A = 'specs/027-checkout';
const P = TEXT.es.problems;
async function inDev(t, surface) {
  const base = await tempDir(t, 'chalc-041-team-');
  const root = await gitRepo(base, { '.chalc/gate.json': JSON.stringify({ language: 'es', spec: { dir: 'specs' } }), '.gitignore': '.chalc/probe-out/\n.chalc/design-out/\n.chalc/team/\n', ...specFiles('027-checkout', { touches: ['src/checkout/**'], surface }) });
  await team(root, 'open', '--feature', 'pagos', A);
  await team(root, 'waves', '--feature', 'pagos');
  assert.equal((await team(root, 'start', '--spec', A)).code, 0);
  const wt = join(base, 'repo.chalc-wt', '027-checkout');
  await writeFiles(wt, { 'src/checkout/api.ts': 'export {};\n' });
  commitAll(wt, 'código');
  return wt;
}
const probed = (wt, extra = {}) => writeFiles(wt, { '.chalc/probe-out/results.json': JSON.stringify({ commit: git(wt, 'rev-parse', 'HEAD').out, spec: A, failures: 0, probes: [], ...extra }) });
const deliver = (wt) => team(wt, 'deliver', '--spec', A);

for (const surface of ['api', 'cli']) {
  test(`R7 (${surface}): sin resultado de sus sondas no se entrega; con él, limpio y de este código, sí`, async (t) => {
    const wt = await inDev(t, surface);
    await passGate(wt, A);
    const refused = await deliver(wt);
    assert.deepEqual([refused.code, refused.text.includes(P['surface-not-probed'](A))], [1, true]);
    const ok = await inDev(t, surface);
    await probed(ok);
    await passGate(ok, A);
    assert.equal((await deliver(ok)).code, 0);
  });
}

test('R7: un resultado con fallos, de otra spec, sin commit o de otro código no vale', async (t) => {
  for (const bad of [{ failures: 1 }, { spec: 'specs/999-otra' }, { commit: '' }, { commit: 'deadbeef' }]) {
    const wt = await inDev(t, 'api');
    await probed(wt, bad);
    await passGate(wt, A);
    assert.equal((await deliver(wt)).text.includes(P['surface-not-probed'](A)), true, JSON.stringify(bad));
  }
  const wt = await inDev(t, 'api');
  await probed(wt);
  await writeFiles(wt, { 'src/checkout/api.ts': 'export const cambiado = 1;\n' });
  commitAll(wt, 'cambio después de sondear');
  await passGate(wt, A);
  assert.equal((await deliver(wt)).code, 1);
});
