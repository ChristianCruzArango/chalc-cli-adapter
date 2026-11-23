// Spec 036 (memoria compartida), T1 — un solo almacén por proyecto (R1, R2): lo que se aprende en el worktree de
// una spec lo leen los demás al momento, porque todos escriben en la memoria del repo principal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { git, gitRepo } from './helpers/teamrepo.mjs';
import { MEMORY_REL, readMemory, remember } from '../catalog/memory/lib/store.mjs';
import { LEARNED_REL, learnSynonym, loadConcepts } from '../catalog/memory/lib/concepts.mjs';
import { sharedRoot } from '../catalog/memory/lib/sharedroot.mjs';
import { mainRoot } from '../catalog/team/lib/root.mjs';

const at = (root, rel) => join(root, ...rel.split('/'));
const same = (a, b) => assert.equal(realpathSync.native(a), realpathSync.native(b));
const ENTRY = { key: 'pagos:total-sin-impuestos', kind: 'rule', concepts: ['pagos'], title: 'El total se calcula sin impuestos', files: ['src/total.ts'] };
// Un repo con dos worktrees (dos specs en marcha) y una subcarpeta.
async function repo(t) {
  const base = await tempDir(t, 'chalc-036-shared-');
  const root = await gitRepo(base, { 'a.txt': 'x', 'packages/app/b.txt': 'y' });
  const [one, two] = [join(base, 'wt-027'), join(base, 'wt-028')];
  for (const [dir, branch] of [[one, 'chalc/027'], [two, 'chalc/028']]) assert.equal(git(root, 'worktree', 'add', '-q', '-b', branch, dir).status, 0);
  return { root, one, two };
}

test('R1: lo que se recuerda desde un worktree va al repo principal, y otro worktree lo lee al momento', async (t) => {
  const { root, one, two } = await repo(t);
  await remember(one, ENTRY);
  assert.ok(existsSync(at(root, MEMORY_REL)));
  for (const dir of [one, two]) assert.equal(existsSync(at(dir, MEMORY_REL)), false, 'sin copia por worktree');
  assert.deepEqual((await readMemory(two)).entries.map((e) => [e.key, e.seen]), [[ENTRY.key, 1]]);
  await remember(two, ENTRY);
  assert.equal((await readMemory(root)).entries[0].seen, 2, 'dos specs tropezando con lo mismo suman');
});

test('R1: los conceptos aprendidos también son de todos', async (t) => {
  const { root, one, two } = await repo(t);
  await learnSynonym(one, 'pagos', 'cobros');
  assert.ok(existsSync(at(root, LEARNED_REL)));
  assert.equal(existsSync(at(one, LEARNED_REL)), false);
  // El sinónimo se guarda normalizado: lo que importa es que el otro worktree lee exactamente lo que se aprendió.
  const learned = JSON.parse(await readFile(at(root, LEARNED_REL), 'utf8')).pagos.synonyms;
  assert.equal(learned.length, 1);
  assert.ok((await loadConcepts(two)).pagos.synonyms.includes(learned[0]));
});

test('R1: sin git, o en el propio repo principal, la memoria es la de esa carpeta', async (t) => {
  const plain = await tempDir(t, 'chalc-036-plain-');
  assert.equal(sharedRoot(plain), plain);
  await remember(plain, ENTRY);
  assert.ok(existsSync(at(plain, MEMORY_REL)));
  const { root } = await repo(t);
  same(sharedRoot(root), root);
});

test('R2: desde una subcarpeta, la raíz es esa MISMA subcarpeta del repo principal, no la raíz del repo', async (t) => {
  const { root, one } = await repo(t);
  same(mainRoot(join(root, 'packages', 'app'), []), join(root, 'packages', 'app'));
  same(mainRoot(join(one, 'packages', 'app'), []), join(root, 'packages', 'app'));
  same(sharedRoot(join(one, 'packages', 'app')), join(root, 'packages', 'app'));
  await mkdir(join(one, 'packages', 'app', '.chalc'), { recursive: true });
  await remember(join(one, 'packages', 'app'), ENTRY);
  assert.ok(existsSync(at(join(root, 'packages', 'app'), MEMORY_REL)));
  assert.equal(existsSync(at(root, MEMORY_REL)), false);
});
