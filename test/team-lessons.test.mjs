// Spec 036 (memoria compartida), T3 — lo aprendido llega a quien trabaja (R3, R5): un rechazo captura en el acto
// la regla que dejó quien revisó, y cada orden lleva las lecciones vigentes del proyecto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { git, gitRepo, specFiles, team, writeFiles } from './helpers/teamrepo.mjs';
import { appendEvent } from '../catalog/team/lib/ledger.mjs';
import { mark, readMemory, remember } from '../catalog/memory/lib/store.mjs';
import { loadConcepts } from '../catalog/memory/lib/concepts.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const A = 'specs/027-checkout';
const ROLES = [{ id: 'seguridad', order: 5, cadence: 'task', required: true }, { id: 'revisor', order: 10, cadence: 'task', required: true }];
// Un repo con la spec A en desarrollo en un worktree de verdad (la memoria se comparte a través de git).
async function working(t) {
  const base = await tempDir(t, 'chalc-036-lessons-');
  const root = await gitRepo(base, {
    '.chalc/gate.json': JSON.stringify({ language: 'es', spec: { dir: 'specs' }, flow: { roles: ROLES } }),
    '.chalc/roles/desarrollador.md': 'rol\n', '.chalc/roles/revisor.md': 'rol\n', ...specFiles('027-checkout', { touches: ['src/checkout/**'] })
  });
  const wt = join(base, 'wt-027');
  assert.equal(git(root, 'worktree', 'add', '-q', '-b', 'chalc/027-checkout', wt).status, 0);
  for (const event of [{ type: 'feature_opened', feature: 'pagos', agent: 'c' }, { type: 'spec_added', feature: 'pagos', spec: A },
    { type: 'started', spec: A, worktree: wt, branch: 'chalc/027-checkout', launcher: 'nativo', tier: 'medio', base: 'b' }]) await appendEvent(root, event);
  return { root, wt, concept: Object.keys(await loadConcepts(root))[0] };
}
const order = (root, role = 'desarrollador') => readFile(join(root, '.chalc', 'team', 'orders', `027-checkout.${role}.md`), 'utf8');

test('R5: la orden lleva las lecciones vigentes: las promovidas, y cómo leer su detalle', async (t) => {
  const { root } = await working(t);
  const saved = await remember(root, { key: 'x:validar-en-servidor', kind: 'rule', concepts: [], title: 'El total se valida en el servidor', files: [] });
  await remember(root, { key: 'x:otra', kind: 'rule', concepts: [], title: 'Lección sin concepto ni promoción', files: [] });
  await mark(root, saved.key, { promoted: true });
  assert.equal((await team(root, 'dispatch', '--spec', A, '--role', 'desarrollador')).code, 0);
  const text = await order(root);
  for (const piece of [TEXT.es.order.lessons, 'El total se valida en el servidor', saved.id, 'node .chalc/memory.mjs get']) assert.ok(text.includes(piece), piece);
  assert.equal(text.includes('Lección sin concepto ni promoción'), false);
});

test('R5: sin nada que aplique, la orden no trae la sección', async (t) => {
  const { root } = await working(t);
  await team(root, 'dispatch', '--spec', A, '--role', 'desarrollador');
  assert.equal((await order(root)).includes(TEXT.es.order.lessons), false);
});

test('R3: al rechazar una entrega, la regla que dejó quien revisó entra a la memoria de todos, con su origen', async (t) => {
  const { root, wt, concept } = await working(t);
  await appendEvent(root, { type: 'delivered', spec: A, head: 'abc1234def' });
  await writeFiles(wt, { '.chalc/review.md': `# Bitácora\n\n## 2026-11-22T10:05:00Z · abc1234 · revisor · FINDINGS: 1\n\n1. El total no se valida.\n- Regla aprendida (${concept}): El total se valida en el servidor — src/total.ts:3\n` });
  const out = await team(root, 'verdict', '--spec', A);
  assert.equal(out.code, 1);
  const { entries } = await readMemory(root);
  assert.deepEqual(entries.map((e) => [e.title, e.origin.role, e.origin.spec, e.concepts]), [['El total se valida en el servidor', 'revisor', '027-checkout', [concept]]]);
  assert.deepEqual((await readMemory(wt)).entries.length, 1, 'el worktree lee el mismo almacén');
  // Y la siguiente orden del desarrollador de OTRA spec con ese concepto ya la trae: aquí, la misma tras el rework.
  await team(root, 'verdict', '--spec', A);
  assert.equal((await readMemory(root)).entries[0].seen, 1, 'repetir el veredicto no la cuenta dos veces');
});

test('R3: un problema al capturar no cambia el veredicto', async (t) => {
  const { root, wt } = await working(t);
  await appendEvent(root, { type: 'delivered', spec: A, head: 'abc1234def' });
  await writeFiles(wt, { '.chalc/review.md': '## 2026-11-22T10:05:00Z · abc1234 · revisor · OK\n\n## 2026-11-22T10:06:00Z · abc1234 · seguridad · OK\n', '.chalc/memory': 'no es una carpeta' });
  await writeFiles(root, { '.chalc/memory': 'no es una carpeta' });
  assert.equal((await team(root, 'verdict', '--spec', A)).code, 0);
});
