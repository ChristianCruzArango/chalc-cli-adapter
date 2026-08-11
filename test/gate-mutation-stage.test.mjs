// T13 (R4, R5) — etapa de mutación: bloqueo, frescura y umbral.
//
// Esta es la etapa que la spec existe para arreglar. Todo lo que aquí "no se puede comprobar" se
// bloquea: herramienta ausente, reporte que no está, reporte viejo reutilizado, reporte ilegible.
// Ninguno de esos casos puede terminar en "aprobado" ni pasar en silencio.
//
// El ejecutor va inyectado: se prueba la lógica de decisión sin instalar Stryker ni esperar minutos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runMutation } from '../catalog/gate/lib/mutation.mjs';

// Instante base fijo: las comparaciones de frescura se hacen contra mtimes puestos a mano, no
// contra el reloj, para que el test no dependa de lo que tarde en correr.
const NOW = 1_700_000_000_000;
const at = (secondsAgo) => new Date(NOW - secondsAgo * 1000);

async function project() {
  return mkdtemp(join(tmpdir(), 'chalc-gate-mut-'));
}

// Escribe un archivo con un mtime controlado.
async function file(dir, rel, content, when = at(0)) {
  const abs = join(dir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
  await utimes(abs, when, when);
  return abs;
}

const config = (mutation = {}) => ({
  mutation: {
    tool: 'stryker',
    command: 'npx stryker run',
    report: 'reports/mutation/mutation.json',
    format: 'elements',
    install: 'npm i -D @stryker-mutator/core @stryker-mutator/jest-runner',
    threshold: 80,
    ...mutation
  }
});

// Reporte de ejemplo del esquema elements, con los estados que se le pidan.
const elementsReport = (statuses) => JSON.stringify({
  schemaVersion: '1.0',
  files: {
    'src/precio.ts': {
      mutants: statuses.map((status, i) => ({
        id: String(i),
        mutatorName: 'ArithmeticOperator',
        location: { start: { line: i + 1, column: 1 }, end: { line: i + 1, column: 9 } },
        status
      }))
    }
  }
});

// Ejecutor de mentira. `writes` simula el efecto real de la herramienta: dejar su reporte.
function runner({ code = 0, writes = null } = {}) {
  const calls = [];
  const run = async (command, opts) => {
    calls.push({ command, cwd: opts?.cwd });
    if (writes) await writes();
    return { code, ms: 1234 };
  };
  run.calls = calls;
  return run;
}

// ── R4: bloqueo ───────────────────────────────────────────────────────────────────────────────

test('runMutation blocks without running anything when no mutation command is configured', async () => {
  const dir = await project();
  const run = runner();

  const r = await runMutation(config({ tool: '', command: '', report: '', format: '', install: '' }), { root: dir, run });

  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  assert.equal(r.reason, 'no-tool');
  assert.equal(run.calls.length, 0, 'sin comando no hay nada que ejecutar');
  assert.equal(r.findings[0].rule, 'no-tool');
});

test('runMutation blocks with the exact install command when the tool is not installed', async () => {
  const dir = await project();

  for (const code of [127, 9009]) {   // sh: command not found · cmd.exe: no se reconoce
    const r = await runMutation(config(), { root: dir, run: runner({ code }) });

    assert.equal(r.blocked, true, `código ${code}`);
    assert.equal(r.reason, 'not-installed');
    // El comando de instalación EXACTO viaja como dato: es lo que el usuario tiene que copiar.
    assert.equal(r.findings[0].data.install, 'npm i -D @stryker-mutator/core @stryker-mutator/jest-runner');
  }
});

// `npx` DESCARGA lo que no encuentra: sin esta comprobación previa, un repo sin Stryker se traería
// un paquete de internet a mitad del portón — y encima el equivocado. Comprobar antes de ejecutar
// evita la descarga y da el mensaje correcto, que el código de salida no permite distinguir.
test('runMutation blocks before running anything when the tool is not present', async () => {
  const dir = await project();
  const run = runner();

  const r = await runMutation(config({ probe: 'node_modules/.bin/stryker' }), { root: dir, run });

  assert.equal(r.blocked, true);
  assert.equal(r.reason, 'not-installed');
  assert.equal(run.calls.length, 0, 'no se ejecuta un comando que va a descargar la herramienta');
  assert.equal(r.findings[0].data.install, 'npm i -D @stryker-mutator/core @stryker-mutator/jest-runner');
});

test('runMutation runs normally when the probe finds the tool', async () => {
  const dir = await project();
  await file(dir, 'node_modules/.bin/stryker', '#!/bin/sh\n');
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed'])) });

  const r = await runMutation(config({ probe: 'node_modules/.bin/stryker' }), { root: dir, run });

  assert.equal(run.calls.length, 1);
  assert.equal(r.ok, true);
});

test('runMutation blocks when the tool left no report', async () => {
  const dir = await project();

  const r = await runMutation(config(), { root: dir, run: runner({ code: 0 }) });

  assert.equal(r.blocked, true);
  assert.equal(r.reason, 'no-report');
  assert.equal(r.score, null);
  // Sin la ruta esperada el usuario no sabe qué mirar.
  assert.equal(r.findings[0].data.report, 'reports/mutation/mutation.json');
});

// Un reporte anterior al fuente más nuevo de la corrida es un reporte de OTRA versión del código.
// Es el caso más peligroso: el archivo existe, el score se lee y todo parece en orden.
test('runMutation blocks when the report is older than the newest source in the run', async () => {
  const dir = await project();
  await file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed', 'Killed']), at(600));
  await file(dir, 'src/precio.ts', 'export const x = 1;\n', at(60));

  const r = await runMutation(config(), { root: dir, changed: ['src/precio.ts'], run: runner({ code: 0 }) });

  assert.equal(r.blocked, true);
  assert.equal(r.reason, 'stale-report');
  assert.equal(r.findings[0].data.source, 'src/precio.ts', 'hay que decir QUÉ archivo invalida el reporte');
});

test('runMutation accepts a report newer than the sources of the run', async () => {
  const dir = await project();
  await file(dir, 'src/precio.ts', 'export const x = 1;\n', at(600));
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed', 'Killed']), at(0)) });

  const r = await runMutation(config(), { root: dir, changed: ['src/precio.ts'], run });

  assert.equal(r.blocked, false);
  assert.equal(r.ok, true);
  assert.equal(r.score, 100);
});

// El mtime idéntico NO es obsoleto. La herramienta escribe el reporte después de leer el fuente, así
// que su mtime nunca es menor; que sean iguales solo significa que el sistema de archivos tiene poca
// resolución (FAT redondea a 2 s). Bloquear ahí sería un falso positivo en cada corrida rápida.
test('runMutation accepts a report written in the same instant as the source', async () => {
  const dir = await project();
  await file(dir, 'src/precio.ts', 'export const x = 1;\n', at(30));
  await file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed']), at(30));

  const r = await runMutation(config(), { root: dir, changed: ['src/precio.ts'], run: runner({ code: 0 }) });

  assert.equal(r.blocked, false, 'mismo mtime no es un reporte de otra versión del código');
  assert.equal(r.score, 100);
});

test('runMutation blocks when the report cannot be parsed instead of scoring it zero', async () => {
  const dir = await project();
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', '{ "resumen": "todo bien, score 92%" }') });

  const r = await runMutation(config(), { root: dir, run });

  assert.equal(r.blocked, true);
  assert.equal(r.reason, 'bad-report');
  assert.equal(r.score, null);
});

test('runMutation blocks when the report has no valid mutant', async () => {
  const dir = await project();
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Ignored', 'CompileError'])) });

  const r = await runMutation(config(), { root: dir, run });

  assert.equal(r.blocked, true);
  assert.equal(r.reason, 'no-mutants');
});

// Stryker sale ≠ 0 cuando el score no alcanza SU propio umbral. Eso no es "no instalado": hay
// reporte fresco y válido, así que manda el reporte, no el código de salida.
test('runMutation trusts a fresh valid report even when the tool exits non-zero', async () => {
  const dir = await project();
  const run = runner({ code: 1, writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed', 'Killed', 'Killed', 'Killed'])) });

  const r = await runMutation(config(), { root: dir, run });

  assert.equal(r.blocked, false);
  assert.equal(r.ok, true);
  assert.equal(r.score, 100);
  assert.equal(r.code, 1);
});

// Stryker.NET escribe en un directorio con marca de tiempo por corrida: la ruta es un glob y hay
// que quedarse con el reporte MÁS NUEVO, no con el primero que aparezca.
test('runMutation resolves a globbed report path to the most recent match', async () => {
  const dir = await project();
  await file(dir, 'StrykerOutput/2024-01-01/reports/mutation-report.json', elementsReport(['Survived', 'Survived']), at(600));
  await file(dir, 'StrykerOutput/2024-06-02/reports/mutation-report.json', elementsReport(['Killed', 'Killed']), at(10));

  const r = await runMutation(
    config({ report: 'StrykerOutput/**/reports/mutation-report.json' }),
    { root: dir, run: runner({ code: 0 }) }
  );

  assert.equal(r.blocked, false);
  assert.equal(r.score, 100, 'se leyó el reporte viejo en vez del de la última corrida');
});

// ── R5: umbral ────────────────────────────────────────────────────────────────────────────────

test('runMutation fails below the threshold and lists every survivor with file and line', async () => {
  const dir = await project();
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed', 'Killed', 'Survived', 'NoCoverage'])) });

  const r = await runMutation(config(), { root: dir, run });

  assert.equal(r.score, 50);
  assert.equal(r.ok, false);
  assert.equal(r.blocked, false, 'no alcanzar el umbral no es un bloqueo: se midió, y el resultado es bajo');
  assert.equal(r.findings.length, 2);
  assert.deepEqual(r.findings.map((f) => [f.file, f.line]), [['src/precio.ts', 3], ['src/precio.ts', 4]]);
  assert.deepEqual(r.findings[0].data, { status: 'Survived', mutator: 'ArithmeticOperator', score: 50, threshold: 80 });
});

test('runMutation honours a threshold lowered in the config', async () => {
  const dir = await project();
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed', 'Killed', 'Survived', 'NoCoverage'])) });

  const r = await runMutation(config({ threshold: 50 }), { root: dir, run });

  assert.equal(r.score, 50);
  assert.equal(r.ok, true, 'el umbral es "menor que", no "menor o igual"');
});

// ── R21: el stack que no se puede verificar ───────────────────────────────────────────────────
// Dart/Flutter no tiene herramienta de mutación estándar. Sin esta salida ninguna tarea del repo
// móvil podría cerrarse nunca, y el equipo acabaría cerrando todo con `--fast`, que es peor.

test('runMutation reports the stage as not applicable when the repo declares it so and there is no parser', async () => {
  const dir = await project();
  const run = runner();

  const r = await runMutation(
    config({ tool: '', command: '', report: '', format: '', install: '', required: false }),
    { root: dir, run }
  );

  assert.equal(r.ok, true);
  assert.equal(r.blocked, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'not-required');
  assert.equal(run.calls.length, 0);
  assert.deepEqual(r.findings, []);
});

// La declaración es una salida para lo imposible, NO un interruptor para apagar la mutación donde
// sí se puede medir. Donde hay parser, se ignora.
test('runMutation ignores the declaration where the gate does have a parser', async () => {
  const dir = await project();
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed', 'Survived'])) });

  const r = await runMutation(config({ required: false }), { root: dir, run });

  assert.equal(run.calls.length, 1, 'con parser disponible la etapa corre igual');
  assert.equal(r.skipped, undefined);
  assert.equal(r.score, 50);
  assert.equal(r.ok, false);
});

test('runMutation keeps blocking an unverifiable stack that did not declare the exception', async () => {
  const dir = await project();

  const r = await runMutation(config({ tool: '', command: '', report: '', format: '', install: '' }), { root: dir, run: runner() });

  assert.equal(r.blocked, true);
  assert.equal(r.reason, 'no-tool');
});

// ── ejecución acotada ─────────────────────────────────────────────────────────────────────────

test('runMutation scopes the run to the changed files when the tool supports it', async () => {
  const dir = await project();
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed'])) });

  await runMutation(
    config({ scopeFlag: '--mutate' }),
    { root: dir, changed: ['src/precio.ts', 'src/total.ts'], run }
  );

  assert.equal(run.calls[0].command, 'npx stryker run --mutate src/precio.ts,src/total.ts');
  assert.equal(run.calls[0].cwd, dir);
});

test('runMutation leaves out of the scope what no mutation tool can mutate', async () => {
  const dir = await project();
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed'])) });

  await runMutation(
    config({ scopeFlag: '--mutate' }),
    {
      root: dir,
      // Lo que el portón trae de git: carpetas, specs y colecciones de API junto al código.
      changed: ['.chalc/', 'specs/008-alta/', 'api/POST-crear.bru', 'docs/plan.md', 'src/precio.ts'],
      run
    }
  );

  assert.equal(run.calls[0].command, 'npx stryker run --mutate src/precio.ts');
});

test('runMutation scopes each file to its own project when the repo has several', async () => {
  const dir = await project();
  // Solución multiproyecto: la herramienta resuelve los globos contra CADA proyecto, no contra la
  // raíz, así que la ruta del repo no casa con ningún archivo y la corrida se queda sin mutantes.
  await file(dir, 'src/Tienda.Dominio/Tienda.Dominio.csproj', '<Project />');
  await file(dir, 'src/Tienda.Dominio/Precios/Total.cs', 'class Total {}');
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed'])) });

  await runMutation(
    config({ scopeFlag: '--mutate' }),
    { root: dir, changed: ['src/Tienda.Dominio/Precios/Total.cs'], run }
  );

  assert.equal(run.calls[0].command, 'npx stryker run --mutate **/Precios/Total.cs');
});

test('runMutation repeats the scope flag for tools that do not take a comma-separated list', async () => {
  const dir = await project();
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed'])) });

  await runMutation(
    config({ scopeFlag: '--mutate', scopeJoin: 'repeat' }),
    { root: dir, changed: ['src/precio.ts', 'src/total.ts'], run }
  );

  // Unidos por coma, Stryker.NET los lee como UN globo con comas dentro: no casa con ningún archivo
  // y la corrida se queda sin mutantes.
  assert.equal(run.calls[0].command, 'npx stryker run --mutate src/precio.ts --mutate src/total.ts');
});

test('runMutation runs the full command when the tool has no scope flag', async () => {
  const dir = await project();
  const run = runner({ writes: () => file(dir, 'reports/mutation/mutation.json', elementsReport(['Killed'])) });

  await runMutation(config(), { root: dir, changed: ['src/precio.ts'], run });

  assert.equal(run.calls[0].command, 'npx stryker run');
});
