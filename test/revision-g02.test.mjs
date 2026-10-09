// G-02 (spec 016, R11) — duplicación con las DOS copias en archivos tocados: se evalúan ambas puntas
// y se reporta la que tiene líneas escritas por la tarea. Antes solo se miraba la primera, y si la
// tarea había editado otra zona de ese archivo el hallazgo se descartaba.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lintDuplication } from '../catalog/gate/lib/duplication.mjs';

const BLOQUE = [
  'const total = items.reduce((a, b) => a + b.monto, 0);',
  'if (total <= 0) {',
  '  throw new PagoInvalido("monto");',
  '}',
  'const comision = total * TASA;',
  'const neto = total - comision;',
  'logger.info("cobro", { total, comision });',
  'return { total, comision, neto };'
].join('\n');
const CONFIG = { enabled: true, minLines: 6, maxFiles: 4000 };

async function repo() {
  const root = await mkdtemp(join(tmpdir(), 'chalc-g02-'));
  // A.ts: el bloque viejo en las líneas 1-8 y una línea editada al final (línea 10).
  await writeFile(join(root, 'A.ts'), `${BLOQUE}\n\nexport const otra = 1;\n`);
  // B.ts: el bloque PEGADO por la tarea (líneas 1-8).
  await writeFile(join(root, 'B.ts'), `${BLOQUE}\n`);
  return root;
}

const lines = (...pairs) => new Map(pairs.map(([file, list]) => [file, new Set(list)]));

test('R11: both copies touched — the copy the task wrote (B) is reported even if A comes first', async () => {
  const root = await repo();
  const changed = lines(['A.ts', [10]], ['B.ts', [1, 2, 3, 4, 5, 6, 7, 8]]);
  const findings = await lintDuplication(root, ['A.ts', 'B.ts'], CONFIG, changed);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'B.ts');
  assert.equal(findings[0].data.other, 'A.ts');
});

test('R11: both copies touched but neither inside the block — nothing is reported', async () => {
  const root = await repo();
  const changed = lines(['A.ts', [10]], ['B.ts', [9]]);
  assert.deepEqual(await lintDuplication(root, ['A.ts', 'B.ts'], CONFIG, changed), []);
});

test('R11: when only A was written inside the block, A is reported', async () => {
  const root = await repo();
  const changed = lines(['A.ts', [3]], ['B.ts', [9]]);
  const findings = await lintDuplication(root, ['A.ts', 'B.ts'], CONFIG, changed);
  assert.deepEqual(findings.map((f) => [f.file, f.data.other]), [['A.ts', 'B.ts']]);
});

test('R11: when the task wrote inside both copies, ONE finding is reported, deterministically on the first', async () => {
  const root = await repo();
  const changed = lines(['A.ts', [2]], ['B.ts', [2]]);
  const findings = await lintDuplication(root, ['A.ts', 'B.ts'], CONFIG, changed);
  assert.deepEqual(findings.map((f) => [f.file, f.data.other]), [['A.ts', 'B.ts']]);
});
