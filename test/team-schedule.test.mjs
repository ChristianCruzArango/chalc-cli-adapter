// Spec 033 (worktrees y olas), T3 — abrir una feature y programar sus specs (R2, R3, R5): solo entra lo que
// existe, y solo se programa lo que el usuario aprobó tal como está.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { GATE_ES, specFiles, team, writeFiles } from './helpers/teamrepo.mjs';
import { readLedger, readStatus } from '../catalog/team/lib/ledger.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const A = 'specs/027-checkout';
const B = 'specs/028-recibos';
const C = 'specs/029-total';
async function repo(t, specs) {
  const root = await tempDir(t, 'chalc-033-sched-');
  await writeFiles(root, { ...GATE_ES, ...Object.assign({}, ...specs) });
  return root;
}
const three = () => [specFiles('027-checkout', { touches: ['src/checkout/**'] }), specFiles('028-recibos', { touches: ['src/recibos/**'] }), specFiles('029-total', { touches: ['src/checkout/total.ts'] })];
const types = async (root) => (await readLedger(root)).map((e) => e.type);
const wavesIn = async (root) => (await readStatus(root)).features[0].specs.map((s) => [s.spec, s.state, s.wave]);

test('R2: `open` registra la feature y sus specs', async (t) => {
  const root = await repo(t, three());
  const out = await team(root, 'open', '--feature', 'pagos', '--agent', 'claude', A, `${B}/`);
  assert.equal(out.code, 0, out.text);
  assert.deepEqual(await types(root), ['feature_opened', 'spec_added', 'spec_added']);
  const status = await readStatus(root);
  assert.deepEqual([status.features[0].feature, status.features[0].lead.agent, status.features[0].specs.map((s) => s.spec)], ['pagos', 'claude', [A, B]]);
});

test('R2: abrir otra vez la misma feature solo añade las specs nuevas', async (t) => {
  const root = await repo(t, three());
  await team(root, 'open', '--feature', 'pagos', A);
  assert.equal((await team(root, 'open', '--feature', 'pagos', C)).code, 0);
  assert.deepEqual(await types(root), ['feature_opened', 'spec_added', 'spec_added']);
});

test('R2: una carpeta que no existe o que ya es de una feature se rechaza sin registrar nada', async (t) => {
  const root = await repo(t, three());
  const missing = await team(root, 'open', '--feature', 'pagos', A, 'specs/099-no-existe');
  assert.equal(missing.code, 1);
  assert.ok(missing.text.includes('specs/099-no-existe'));
  assert.deepEqual(await types(root), []);
  await team(root, 'open', '--feature', 'pagos', A);
  const twice = await team(root, 'open', '--feature', 'envios', B, A);
  assert.equal(twice.code, 1);
  assert.ok(twice.text.includes(A));
  assert.equal((await types(root)).length, 2);
});

test('R2: sin feature o sin carpetas, muestra el uso', async (t) => {
  const root = await repo(t, three());
  for (const args of [['open', A], ['open', '--feature', 'pagos']]) {
    const out = await team(root, ...args);
    assert.equal(out.code, 1);
    assert.ok(out.text.includes(TEXT.es.openUsage));
  }
});

test('R3: `waves` programa cada spec en su ola: las que se solapan, separadas', async (t) => {
  const root = await repo(t, three());
  await team(root, 'open', '--feature', 'pagos', A, B, C);
  const out = await team(root, 'waves', '--feature', 'pagos');
  assert.equal(out.code, 0, out.text);
  assert.deepEqual(await wavesIn(root), [[A, 'scheduled', 1], [B, 'scheduled', 1], [C, 'scheduled', 2]]);
  for (const piece of [A, B, C, '1', '2']) assert.ok(out.text.includes(piece), piece);
});

test('R3: una dependencia manda a la spec a una ola posterior; y se puede reprogramar mientras nadie empezó', async (t) => {
  const root = await repo(t, [specFiles('027-checkout', { touches: ['src/a/**'], dependsOn: ['028-recibos'] }), specFiles('028-recibos', { touches: ['src/b/**'] })]);
  await team(root, 'open', '--feature', 'pagos', A, B);
  assert.equal((await team(root, 'waves', '--feature', 'pagos')).code, 0);
  assert.equal((await team(root, 'waves', '--feature', 'pagos')).code, 0);
  assert.deepEqual(await wavesIn(root), [[A, 'scheduled', 2], [B, 'scheduled', 1]]);
});

test('R5: una spec sin aprobar, o editada después de aprobarla, no se programa: ninguna', async (t) => {
  const unsealed = await repo(t, [specFiles('027-checkout', { touches: ['a'] }), specFiles('028-recibos', { touches: ['b'], sealed: false })]);
  await team(unsealed, 'open', '--feature', 'pagos', A, B);
  const out = await team(unsealed, 'waves', '--feature', 'pagos');
  assert.equal(out.code, 1);
  assert.ok(out.text.includes(TEXT.es.problems['not-approved'](B)));
  assert.deepEqual(await wavesIn(unsealed), [[A, 'draft', null], [B, 'draft', null]]);

  const edited = await repo(t, three());
  await team(edited, 'open', '--feature', 'pagos', A, B);
  await appendFile(join(edited, 'specs', '027-checkout', 'spec.md'), '\n- **R9** — otro requisito.\n');
  assert.ok((await team(edited, 'waves', '--feature', 'pagos')).text.includes(TEXT.es.problems['not-approved'](A)));
});

test('R5: dependencia desconocida y ciclo se rechazan diciendo cuál', async (t) => {
  const orphan = await repo(t, [specFiles('027-checkout', { touches: ['a'], dependsOn: ['099-otra'] })]);
  await team(orphan, 'open', '--feature', 'pagos', A);
  const first = await team(orphan, 'waves', '--feature', 'pagos');
  assert.deepEqual([first.code, first.text.includes(TEXT.es.problems['unknown-dependency'](A))], [1, true]);

  const cycle = await repo(t, [specFiles('027-checkout', { touches: ['a'], dependsOn: ['028-recibos'] }), specFiles('028-recibos', { touches: ['b'], dependsOn: ['027-checkout'] })]);
  await team(cycle, 'open', '--feature', 'pagos', A, B);
  const second = await team(cycle, 'waves', '--feature', 'pagos');
  assert.deepEqual([second.code, second.text.includes(TEXT.es.problems['dependency-cycle'](A))], [1, true]);
});

test('R5: una feature desconocida, o una con alguna spec ya empezada, no se reprograma', async (t) => {
  const root = await repo(t, three());
  const unknown = await team(root, 'waves', '--feature', 'nadie');
  assert.deepEqual([unknown.code, unknown.text.includes(TEXT.es.problems['unknown-feature']('nadie'))], [1, true]);
  assert.equal((await team(root, 'waves')).code, 1);
  await team(root, 'open', '--feature', 'pagos', A, B);
  await team(root, 'waves', '--feature', 'pagos');
  await team(root, 'event', 'started', `spec=${A}`, 'worktree=w', 'branch=b', 'launcher=nativo', 'tier=medio');
  const late = await team(root, 'waves', '--feature', 'pagos');
  assert.deepEqual([late.code, late.text.includes(TEXT.es.problems['already-started'](A))], [1, true]);
});
