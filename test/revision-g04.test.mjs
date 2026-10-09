// G-04 (spec 016, R13) — el tope `maxFiles` de la duplicación no puede dejar fuera, en silencio, el
// archivo que cambió la tarea: los cambiados entran siempre, y que el recorrido se acotó se ve en la
// etapa y en la evidencia (gate.md y gate.state.json) aunque no haya hallazgos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { scanDuplication, lintDuplication } from '../catalog/gate/lib/duplication.mjs';
import { runGate } from '../catalog/gate/gate.mjs';
import { renderEvidence, renderState } from '../catalog/gate/lib/evidence.mjs';

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

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-g04-'));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

test('R13: a changed file is always analysed even when the scan hits maxFiles', async () => {
  const root = await project({ 'a.ts': BLOQUE, 'b.ts': 'export const b = 1;\n', 'c.ts': BLOQUE });
  const result = await scanDuplication(root, ['c.ts'], { enabled: true, minLines: 6, maxFiles: 1 }, null);
  assert.equal(result.capped, true);
  assert.deepEqual(result.findings.map((f) => f.file), ['c.ts']);
});

test('R13: deleted or non-source changed files do not break the scan', async () => {
  const root = await project({ 'a.ts': 'export const a = 1;\n' });
  const result = await scanDuplication(root, ['borrado.ts', 'README.md', '.chalc/gate.json'], { enabled: true, minLines: 6, maxFiles: 10 }, null);
  assert.deepEqual(result, { findings: [], capped: false });
});

test('R13: lintDuplication keeps returning the findings array (existing API)', async () => {
  const root = await project({ 'a.ts': BLOQUE, 'c.ts': BLOQUE });
  const findings = await lintDuplication(root, ['c.ts'], { enabled: true, minLines: 6, maxFiles: 10 }, null);
  assert.ok(Array.isArray(findings));
  assert.equal(findings.length, 1);
  assert.deepEqual(await scanDuplication(root, ['c.ts'], { enabled: false }), { findings: [], capped: false });
});

test('R13: capped is visible in the stage, gate.md and gate.state.json even with no findings', async () => {
  const dir = await project({
    '.chalc/gate.json': {
      stack: 'js', test: { command: 'npm test' },
      mutation: { tool: '', command: '', report: '', format: '', threshold: 80, required: false, scopeFlag: '' },
      lint: { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3, duplication: { enabled: true, minLines: 6, maxFiles: 1 } },
      spec: { dir: 'specs' }, role: 'back', language: 'es'
    },
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': 'export const b = 2;\n'
  });
  const result = await runGate({ root: dir, run: async () => ({ code: 0, ms: 1 }), fast: true, changed: ['src/b.ts'] });
  const stage = result.stages.find((s) => s.stage === 'duplication');
  assert.equal(stage.findings.length, 0);
  assert.equal(stage.capped, true);
  const md = await readFile(join(dir, '.chalc', 'gate.md'), 'utf8');
  assert.match(md, /maxFiles/);
  const state = JSON.parse(await readFile(join(dir, '.chalc', 'gate.state.json'), 'utf8'));
  assert.equal(state.stages.find((s) => s.stage === 'duplication').capped, true);
});

test('R13: the capped note is translated and absent when the scan was not capped', () => {
  const meta = { date: new Date(0) };
  const stage = (capped) => ({ stage: 'duplication', ok: true, findings: [], ms: 1, ...(capped ? { capped } : {}) });
  const es = renderEvidence({ stages: [stage(true)], meta, lang: 'es' });
  const en = renderEvidence({ stages: [stage(true)], meta, lang: 'en' });
  assert.notEqual(es.match(/.*maxFiles.*/)[0], en.match(/.*maxFiles.*/)[0]);
  assert.doesNotMatch(renderEvidence({ stages: [stage(false)], meta, lang: 'es' }), /maxFiles/);
  assert.equal(renderState({ stages: [stage(false)], meta }).stages[0].capped, false);
});

test('R13: a changed NON-source file (README) never enters the comparison', async () => {
  const root = await project({ 'a.ts': BLOQUE, 'README.md': BLOQUE });
  const result = await scanDuplication(root, ['README.md'], { enabled: true, minLines: 6, maxFiles: 10 }, null);
  assert.deepEqual(result.findings, []);
});
