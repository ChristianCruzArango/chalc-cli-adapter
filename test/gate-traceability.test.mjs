// T18 (R7) — trazabilidad: cada test cambiado cita un requisito que EXISTE en la spec.
//
// Es la regla que sostiene el método: si un test no dice qué requisito cubre, nadie puede saber si
// la spec quedó implementada, y "todo verde" deja de significar nada. Citar un `R#` inventado es
// peor que no citar ninguno — parece trazado y no lo está.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { checkTraceability, requirementsOf } from '../catalog/gate/lib/traceability.mjs';

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-trace-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

const spec = [
  '# Spec: carrito',
  '',
  '- **R1** — WHEN el usuario agrega un ítem THE SYSTEM SHALL recalcular el total.',
  '- **R2** — WHEN el carrito está vacío THE SYSTEM SHALL deshabilitar el pago.',
  '- **R3** — WHEN se aplica un cupón THE SYSTEM SHALL validar su vigencia.',
  '',
  '> Nota: esto reemplaza lo que decía R9 de la spec 006.'
].join('\n');

const of = (findings, rule) => findings.filter((f) => f.rule === rule);

// ── lectura de la spec ────────────────────────────────────────────────────────────────────────

test('requirementsOf reads the declared requirements and not the ones mentioned in prose', async () => {
  assert.deepEqual([...requirementsOf(spec)].sort(), ['R1', 'R2', 'R3']);
});

// Una spec escrita a mano puede no usar negritas: antes que no comprobar nada, se toma lo que haya.
test('requirementsOf falls back to every R# when the spec declares none in bold', async () => {
  assert.deepEqual([...requirementsOf('R1 el sistema calcula\nR2 el sistema cobra')].sort(), ['R1', 'R2']);
});

// ── hallazgos ─────────────────────────────────────────────────────────────────────────────────

test('checkTraceability reports a changed test that cites no requirement', async () => {
  const dir = await project({
    'specs/007-carrito/spec.md': spec,
    'test/total.test.ts': "import test from 'node:test';\n\ntest('suma', () => {});\n"
  });

  const findings = await checkTraceability(['test/total.test.ts'], { root: dir });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'no-requirement');
  assert.equal(findings[0].file, 'test/total.test.ts');
  assert.equal(findings[0].line, 1);
});

test('checkTraceability reports a test citing a requirement the spec does not have', async () => {
  const dir = await project({
    'specs/007-carrito/spec.md': spec,
    'test/total.test.ts': "import test from 'node:test';\n// R9 — total del carrito\ntest('suma', () => {});\n"
  });

  const findings = await checkTraceability(['test/total.test.ts'], { root: dir });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'unknown-requirement');
  assert.equal(findings[0].line, 2, 'se señala la cita, que es lo que hay que corregir');
  assert.equal(findings[0].data.id, 'R9');
  assert.equal(findings[0].data.spec, 'specs/007-carrito/spec.md');
});

test('checkTraceability accepts a test that cites an existing requirement', async () => {
  const dir = await project({
    'specs/007-carrito/spec.md': spec,
    'test/total.test.ts': "// R3 — vigencia del cupón\nimport test from 'node:test';\n"
  });

  assert.deepEqual(await checkTraceability(['test/total.test.ts'], { root: dir }), []);
});

test('checkTraceability still reports an invented requirement cited next to a valid one', async () => {
  const dir = await project({
    'specs/007-carrito/spec.md': spec,
    'test/total.test.ts': '// R3 — vigencia\n// R42 — inventado\n'
  });

  const findings = await checkTraceability(['test/total.test.ts'], { root: dir });

  assert.equal(of(findings, 'unknown-requirement').length, 1);
  assert.equal(findings[0].line, 2);
});

// ── alcance ───────────────────────────────────────────────────────────────────────────────────

test('checkTraceability looks only at test files', async () => {
  const dir = await project({
    'specs/007-carrito/spec.md': spec,
    'src/total.ts': 'export const total = () => 0;\n'
  });

  assert.deepEqual(await checkTraceability(['src/total.ts'], { root: dir }), []);
});

test('checkTraceability recognises the test naming conventions of each stack', async () => {
  const sinCita = "test('x', () => {});\n";
  const dir = await project({
    'specs/007-carrito/spec.md': spec,
    'src/total.spec.ts': sinCita,
    'test/carrito_test.dart': sinCita,
    'tests/test_total.py': sinCita,
    'Domain/PrecioTests.cs': sinCita,
    'src/__tests__/total.js': sinCita
  });

  const findings = await checkTraceability(
    ['src/total.spec.ts', 'test/carrito_test.dart', 'tests/test_total.py', 'Domain/PrecioTests.cs', 'src/__tests__/total.js'],
    { root: dir }
  );

  assert.equal(findings.length, 5);
});

// R7 es condicional: sin spec no hay requisitos contra los que trazar y la regla no aplica.
test('checkTraceability stays quiet when the repo has no spec', async () => {
  const dir = await project({ 'test/total.test.ts': "test('x', () => {});\n" });

  assert.deepEqual(await checkTraceability(['test/total.test.ts'], { root: dir }), []);
});

// El flujo de chalc trabaja siempre sobre la spec recién creada: es la que numera más alto.
test('checkTraceability traces against the newest spec of the repo', async () => {
  const dir = await project({
    'specs/006-viejo/spec.md': '- **R9** — WHEN algo THE SYSTEM SHALL otra cosa.',
    'specs/007-carrito/spec.md': spec,
    'test/total.test.ts': '// R9 — de la spec vieja\n'
  });

  const findings = await checkTraceability(['test/total.test.ts'], { root: dir });

  assert.equal(findings[0].rule, 'unknown-requirement');
});

test('checkTraceability skips a test file deleted in the task', async () => {
  const dir = await project({ 'specs/007-carrito/spec.md': spec });

  assert.deepEqual(await checkTraceability(['test/borrado.test.ts'], { root: dir }), []);
});
