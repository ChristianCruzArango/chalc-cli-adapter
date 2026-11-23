// Spec 024 (coherencia), T1 — una sola carpeta activa (R1, R2, R25): la que nombre `.chalc/active-spec` o,
// sin ese archivo, la `specs/NNN-*` de número más alto. Nunca se recurre a una carpeta anterior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { activeSpecDir, activeSpecFile, newestSpec } from '../catalog/gate/lib/spec.mjs';
import { readSpecSet, SPEC_FILES } from '../catalog/gate/lib/specset.mjs';

async function repo(t, files = {}, pin) {
  const root = await tempDir(t, 'chalc-024-active-');
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'));
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, text);
  }
  if (pin !== undefined) {
    await mkdir(join(root, '.chalc'), { recursive: true });
    await writeFile(join(root, '.chalc', 'active-spec'), pin);
  }
  return root;
}

const TWO = {
  'specs/001-login/spec.md': 'spec 1', 'specs/001-login/tasks.md': 'tasks 1',
  'specs/002-pagos/spec.md': 'spec 2',
  'specs/_template/spec.md': 'plantilla', 'specs/constitution.md': 'c'
};

test('R1: sin .chalc/active-spec la carpeta activa es la de número más alto', async (t) => {
  const root = await repo(t, { ...TWO, 'specs/010-zeta/hu.md': 'hu' });
  assert.deepEqual(await activeSpecDir(root, 'specs'), { dir: 'specs/010-zeta', problem: '', pinned: false });
});

test('R1: el orden es numérico, no alfabético, y las carpetas sin número no cuentan', async (t) => {
  const root = await repo(t, { 'specs/9-a/spec.md': 'a', 'specs/10-b/spec.md': 'b', 'specs/notas/spec.md': 'n' });
  assert.equal((await activeSpecDir(root, 'specs')).dir, 'specs/10-b');
});

test('R1: .chalc/active-spec fija la carpeta activa aunque exista una de número mayor', async (t) => {
  for (const pin of ['001-login', 'specs/001-login', '  001-login  \n', '001-login\notra línea']) {
    const root = await repo(t, TWO, pin);
    assert.deepEqual(await activeSpecDir(root, 'specs'), { dir: 'specs/001-login', problem: '', pinned: true }, JSON.stringify(pin));
  }
});

test('R25: un active-spec que no nombra una specs/NNN-* real es un problema y no se recurre a otra', async (t) => {
  for (const pin of ['099-no-existe', '', '   \n', '../fuera', 'specs/../001-login', '_template', 'constitution.md', 'otra/001-login']) {
    const root = await repo(t, TWO, pin);
    assert.deepEqual(await activeSpecDir(root, 'specs'), { dir: null, problem: 'active-spec-invalid', pinned: true }, JSON.stringify(pin));
  }
});

test('R1: sin ninguna carpeta numerada (o sin specs/) no hay carpeta activa', async (t) => {
  assert.deepEqual(await activeSpecDir(await repo(t, { 'specs/_template/spec.md': 'x' }), 'specs'), { dir: null, problem: 'no-spec', pinned: false });
  assert.deepEqual(await activeSpecDir(await repo(t), 'specs'), { dir: null, problem: 'no-spec', pinned: false });
});

test('R2: activeSpecFile lee SOLO de la carpeta activa; si falta, null (newestSpec sí baja a la anterior)', async (t) => {
  const root = await repo(t, TWO);
  assert.deepEqual(await activeSpecFile(root, 'specs', 'spec.md'), { dir: 'specs/002-pagos', path: 'specs/002-pagos/spec.md', text: 'spec 2' });
  assert.equal(await activeSpecFile(root, 'specs', 'tasks.md'), null);
  assert.equal((await newestSpec(root, 'specs', 'tasks.md')).dir, 'specs/001-login', 'el comportamiento anterior sigue para la trazabilidad');
});

test('R2: activeSpecFile sin carpeta activa devuelve null', async (t) => {
  assert.equal(await activeSpecFile(await repo(t), 'specs', 'spec.md'), null);
  assert.equal(await activeSpecFile(await repo(t, TWO, '099-no-existe'), 'specs', 'spec.md'), null);
});

test('R1/R2: readSpecSet trae hu, spec, plan y tasks de la carpeta activa, con null en lo que falta', async (t) => {
  assert.deepEqual(SPEC_FILES, ['hu.md', 'spec.md', 'plan.md', 'tasks.md']);
  const root = await repo(t, { ...TWO, 'specs/002-pagos/hu.md': 'la hu', 'specs/002-pagos/plan.md': '' });
  assert.deepEqual(await readSpecSet(root, 'specs'), {
    dir: 'specs/002-pagos', problem: '', pinned: false,
    // `design.md` es opcional (spec 038): se lee con la spec, y aquí no existe.
    files: { 'hu.md': 'la hu', 'spec.md': 'spec 2', 'plan.md': '', 'tasks.md': null, 'design.md': null, 'probes.json': null }
  });
});

test('R25: readSpecSet sin carpeta activa no lee nada y conserva el problema', async (t) => {
  const root = await repo(t, TWO, '099-no-existe');
  assert.deepEqual(await readSpecSet(root, 'specs'), {
    dir: null, problem: 'active-spec-invalid', pinned: true,
    files: { 'hu.md': null, 'spec.md': null, 'plan.md': null, 'tasks.md': null, 'design.md': null, 'probes.json': null }
  });
});
