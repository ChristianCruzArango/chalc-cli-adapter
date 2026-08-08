// T11 (R3) — parsers de los reportes NATIVOS en XML: `junit` (el que escribe `mutmut junitxml`) y
// `pit` (el `mutations.xml` de PIT). Misma firma y misma forma de salida que `parseElements`, para
// que `mutation.mjs` los despache por tabla sin ramificar por herramienta.
//
// Igual que en el esquema elements: el score sale del ARCHIVO de reporte, y un shape que no encaja
// falla explícitamente en vez de devolver 0.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJUnit } from '../catalog/gate/lib/report-junit.mjs';
import { parsePit } from '../catalog/gate/lib/report-pit.mjs';

// ── junit (mutmut) ────────────────────────────────────────────────────────────────────────────
// mutmut emite un <testcase> por mutante: sin hijos = cazado; <failure> = sobrevivió;
// <skipped> = no se probó y la política lo salta; <error> = sospechoso o sin cobertura.
const junitCase = (file, line, child = null) => (child
  ? `<testcase classname="mutmut" name="${file}:${line}: mutant" file="${file}" line="${line}">${child}</testcase>`
  : `<testcase classname="mutmut" name="${file}:${line}: mutant" file="${file}" line="${line}" />`);

const junit = (cases) => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites disabled="0" errors="0" failures="0" name="mutmut" tests="${cases.length}" time="0.0">
<testsuite name="mutmut" tests="${cases.length}">
${cases.join('\n')}
</testsuite>
</testsuites>`;

test('parseJUnit derives the score from the testcase outcomes', async () => {
  const text = junit([
    junitCase('src/precio.py', 4),
    junitCase('src/precio.py', 9),
    junitCase('src/total.py', 12, '<failure message="failure">--- src/total.py\n+++ mutant</failure>'),
    junitCase('src/total.py', 20, '<error message="untested">no test covers this line</error>')
  ]);

  const r = parseJUnit(text);

  assert.equal(r.killed, 2);
  assert.equal(r.survived, 1);
  // <error> agrupa "sospechoso" y "sin cobertura": el XML no los distingue, así que cuenta como
  // NO detectado. Contarlo como cazado sería aprobar sin evidencia.
  assert.equal(r.noCoverage, 1);
  assert.equal(r.total, 4);
  assert.equal(r.score, 50);
});

test('parseJUnit reads a killed mutant written as a non self-closing tag', async () => {
  const r = parseJUnit(junit([`<testcase classname="mutmut" name="src/x.py:1: mutant" file="src/x.py" line="1"></testcase>`]));

  assert.equal(r.killed, 1);
  assert.equal(r.score, 100);
});

test('parseJUnit lists survivors with file and line, sorted', async () => {
  const text = junit([
    junitCase('src/total.py', 12, '<failure message="failure">diff</failure>'),
    junitCase('src/precio.py', 8, '<error message="untested">sin cobertura</error>'),
    junitCase('src/precio.py', 3)
  ]);

  const r = parseJUnit(text);

  assert.equal(r.survivors.length, 2);
  // mutmut no dice qué mutador aplicó: el campo queda vacío en vez de inventarse un nombre.
  assert.deepEqual(r.survivors[0], { file: 'src/precio.py', line: 8, mutator: '', status: 'NoCoverage' });
  assert.deepEqual(r.survivors[1], { file: 'src/total.py', line: 12, mutator: '', status: 'Survived' });
});

// Un mutante saltado por política no es un test flojo: fuera del denominador, igual que Ignored.
test('parseJUnit excludes skipped mutants from the score', async () => {
  const text = junit([
    junitCase('src/x.py', 1),
    junitCase('src/x.py', 2, '<skipped message="untested">skipped by policy</skipped>')
  ]);

  const r = parseJUnit(text);

  assert.equal(r.total, 1);
  assert.equal(r.score, 100);
  assert.deepEqual(r.survivors, []);
});

// Versiones viejas de mutmut no ponen file/line como atributos, solo el nombre `ruta:línea: …`.
test('parseJUnit falls back to the testcase name when file and line are not attributes', async () => {
  const text = junit([`<testcase classname="mutmut" name="src/carrito.py:37: mutant"><failure message="failure">diff</failure></testcase>`]);

  const r = parseJUnit(text);

  assert.deepEqual(r.survivors[0], { file: 'src/carrito.py', line: 37, mutator: '', status: 'Survived' });
});

test('parseJUnit throws when the shape does not match a junit report', async () => {
  assert.throws(() => parseJUnit('<html><body>todo bien, score 92%</body></html>'), /testsuite/i);
});

test('parseJUnit returns a null score when there is no valid testcase', async () => {
  const r = parseJUnit(junit([junitCase('src/x.py', 1, '<skipped message="untested">skip</skipped>')]));

  assert.equal(r.score, null);
  assert.equal(r.total, 0);
});

// ── pit ───────────────────────────────────────────────────────────────────────────────────────
const pitMutation = ({ status, line, cls = 'com.example.domain.Precio', file = 'Precio.java', mutator = 'org.pitest.mutationtest.engine.gregor.mutators.MathMutator' }) =>
  `<mutation detected="${status === 'KILLED' || status === 'TIMED_OUT'}" status="${status}" numberOfTestsRun="2">
    <sourceFile>${file}</sourceFile>
    <mutatedClass>${cls}</mutatedClass>
    <mutatedMethod>total</mutatedMethod>
    <methodDescription>()D</methodDescription>
    <lineNumber>${line}</lineNumber>
    <mutator>${mutator}</mutator>
    <description>Replaced double addition with subtraction</description>
  </mutation>`;

const pit = (mutations) => `<?xml version="1.0" encoding="UTF-8"?>
<mutations partial="false">
${mutations.join('\n')}
</mutations>`;

test('parsePit derives the score from the mutation statuses', async () => {
  const text = pit([
    pitMutation({ status: 'KILLED', line: 4 }),
    pitMutation({ status: 'TIMED_OUT', line: 7 }),
    pitMutation({ status: 'SURVIVED', line: 12 }),
    pitMutation({ status: 'NO_COVERAGE', line: 20 })
  ]);

  const r = parsePit(text);

  assert.equal(r.killed, 1);
  assert.equal(r.timeout, 1);
  assert.equal(r.survived, 1);
  assert.equal(r.noCoverage, 1);
  assert.equal(r.total, 4);
  assert.equal(r.score, 50);
});

test('parsePit lists survivors with the source path, line and short mutator name', async () => {
  const text = pit([
    pitMutation({ status: 'SURVIVED', line: 42, cls: 'com.example.domain.Precio', file: 'Precio.java' }),
    pitMutation({
      status: 'NO_COVERAGE', line: 8, cls: 'com.example.api.Carrito', file: 'Carrito.java',
      mutator: 'org.pitest.mutationtest.engine.gregor.mutators.ConditionalsBoundaryMutator'
    })
  ]);

  const r = parsePit(text);

  // El paquete de la clase da la ruta: dos `Precio.java` en paquetes distintos no pueden confundirse.
  assert.deepEqual(r.survivors[0], {
    file: 'com/example/api/Carrito.java', line: 8, mutator: 'ConditionalsBoundaryMutator', status: 'NoCoverage'
  });
  assert.deepEqual(r.survivors[1], {
    file: 'com/example/domain/Precio.java', line: 42, mutator: 'MathMutator', status: 'Survived'
  });
});

test('parsePit uses the bare source file when the class has no package', async () => {
  const r = parsePit(pit([pitMutation({ status: 'SURVIVED', line: 3, cls: 'Precio', file: 'Precio.java' })]));

  assert.equal(r.survivors[0].file, 'Precio.java');
});

// Un mutante que no compila, revienta la JVM o falla al correr no mide la calidad de las pruebas.
test('parsePit excludes non-viable and erroring mutants from the score', async () => {
  const text = pit([
    pitMutation({ status: 'KILLED', line: 1 }),
    pitMutation({ status: 'NON_VIABLE', line: 2 }),
    pitMutation({ status: 'MEMORY_ERROR', line: 3 }),
    pitMutation({ status: 'RUN_ERROR', line: 4 })
  ]);

  const r = parsePit(text);

  assert.equal(r.total, 1);
  assert.equal(r.score, 100);
  assert.deepEqual(r.survivors, []);
});

test('parsePit throws when the shape does not match a pit report', async () => {
  assert.throws(() => parsePit('<html><body>todo bien, score 92%</body></html>'), /mutations/i);
});

test('parsePit returns a null score when there is no valid mutant', async () => {
  const r = parsePit(pit([pitMutation({ status: 'NON_VIABLE', line: 1 })]));

  assert.equal(r.score, null);
  assert.equal(r.total, 0);
});
