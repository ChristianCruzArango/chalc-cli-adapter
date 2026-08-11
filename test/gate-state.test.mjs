// T11 (R13, R14) — `.chalc/gate.state.json`, el gemelo del informe legible por máquina.
//
// `.chalc/gate.md` está escrito para un humano y en el idioma del spec: el veredicto es un
// encabezado traducido y el aviso de `--fast` una frase. Si el advisor tuviera que parsear eso,
// habría que congelar la redacción del informe y conocer los dos idiomas — y se rompería con el
// primer retoque de estilo.
//
// La salida es un artefacto por audiencia, ambos escritos por el MISMO `finish()`. Es el argumento
// con el que la spec 007 exportó `verdictOf`: si el titular del informe y el código de salida
// salieran de cálculos distintos, podrían contradecirse. Aquí igual, con un tercer consumidor.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGate } from '../catalog/gate/gate.mjs';
import { renderState, STATE_REL, verdictOf } from '../catalog/gate/lib/evidence.mjs';
import { frameOf } from '../catalog/gate/lib/i18n.mjs';

const DATE = new Date('2026-08-09T14:32:11Z');

const passed = (stage) => ({ stage, ok: true, blocked: false, command: 'npm test', code: 0, ms: 10, findings: [] });
const failed = (stage) => ({ stage, ok: false, blocked: false, command: 'npm test', code: 1, ms: 10, findings: [] });
const blocked = (stage) => ({ stage, ok: false, blocked: true, reason: 'no-report', command: '', code: null, ms: 0, findings: [] });
const skippedFast = () => ({ stage: 'mutation', ok: true, blocked: false, skipped: true, reason: 'fast', command: '', code: null, ms: 0, findings: [] });

const meta = (over = {}) => ({ date: DATE, branch: 'feature/008-advisor', role: 'back', spec: 'specs/008-advisor', ...over });

// Corre el portón en un repo equipado en `language` y devuelve el texto del estado que dejó.
async function stateOfRun(language) {
  const root = await equipped({ language });
  await runGate({ root, changed: ['src/precio.ts'], run: async () => ({ code: 1, ms: 10 }) });
  return readFile(join(root, STATE_REL), 'utf8');
}

// ── el estado dice lo mismo que el informe, sin una palabra traducida ─────────────────────────

test('R13 — el estado trae fecha, veredicto, rama, spec y rol', () => {
  const state = renderState({ stages: [passed('tests')], meta: meta(), fast: false });

  assert.equal(state.date, DATE.toISOString());
  assert.equal(state.verdict, 'pass');
  assert.equal(state.branch, 'feature/008-advisor');
  assert.equal(state.spec, 'specs/008-advisor');
  assert.equal(state.role, 'back');
});

test('R13 — el veredicto del estado sale del MISMO cálculo que titula el informe', () => {
  for (const stages of [[passed('tests')], [failed('tests')], [blocked('mutation')], [passed('tests'), blocked('mutation')]]) {
    assert.equal(renderState({ stages, meta: meta(), fast: false }).verdict, verdictOf(stages));
  }
});

// La invariante real no es "no contiene tal palabra" — `blocked` es a la vez un veredicto válido y
// la etiqueta inglesa de una etapa bloqueada, así que comparar cadenas confunde el contrato con la
// redacción. Lo que hay que garantizar es que el estado NO DEPENDE del idioma: si cambiara con
// `--lang`, el advisor tendría que conocer los dos y volveríamos al problema que este archivo evita.
test('R13 — el estado es idéntico sea cual sea el idioma del spec', async () => {
  const stages = [failed('tests'), blocked('mutation'), skippedFast()];
  const state = renderState({ stages, meta: meta(), fast: true });

  const inSpanish = JSON.parse(await stateOfRun('es'));
  const inEnglish = JSON.parse(await stateOfRun('en'));

  delete inSpanish.date;
  delete inEnglish.date;
  assert.deepEqual(inSpanish, inEnglish, 'el idioma del spec no puede cambiar el estado');

  // Y el informe SÍ cambia: es la prueba de que son dos artefactos con audiencias distintas.
  assert.notEqual(frameOf('es').verdict.pass, frameOf('en').verdict.pass);
  assert.ok(!('lang' in state), 'el estado no lleva idioma porque no lo necesita');
});

test('R13 — el estado enumera las etapas con su resultado, sin redacción', () => {
  const state = renderState({ stages: [passed('tests'), blocked('mutation')], meta: meta(), fast: false });

  assert.equal(state.stages.length, 2);
  assert.deepEqual(
    state.stages.map((s) => ({ stage: s.stage, ok: s.ok, blocked: s.blocked })),
    [{ stage: 'tests', ok: true, blocked: false }, { stage: 'mutation', ok: false, blocked: true }]
  );
});

// ── R14: el --fast queda registrado, que es lo que impide cerrar tarea ────────────────────────

test('R14 — una corrida --fast lo dice en el estado y no cierra tarea', () => {
  const state = renderState({ stages: [passed('tests'), skippedFast()], meta: meta(), fast: true });

  assert.equal(state.fast, true);
  assert.equal(state.closesTask, false);
});

test('R14 — una corrida completa en verde sí cierra tarea', () => {
  const state = renderState({ stages: [passed('tests'), passed('mutation')], meta: meta(), fast: false });

  assert.equal(state.fast, false);
  assert.equal(state.closesTask, true);
});

test('R14 — una corrida completa que falla no cierra tarea', () => {
  assert.equal(renderState({ stages: [failed('tests')], meta: meta(), fast: false }).closesTask, false);
});

// ── el portón deja los dos artefactos en la misma corrida ─────────────────────────────────────

async function equipped({ language = 'es' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-gate-state-'));
  await mkdir(join(root, '.chalc'), { recursive: true });
  await mkdir(join(root, 'specs', '008-advisor'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({
    test: { command: 'npm test' },
    mutation: { tool: '', command: '', required: false },
    spec: { dir: 'specs' }, role: 'back', language
  }));
  await writeFile(join(root, 'specs', '008-advisor', 'spec.md'), '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.');
  await writeFile(join(root, 'src', 'precio.ts'), 'export const precio = () => 1;\n');
  return root;
}

test('R13 — una corrida del portón deja el informe Y el estado', async () => {
  const root = await equipped();
  await runGate({ root, changed: ['src/precio.ts'], run: async () => ({ code: 0, ms: 10 }) });

  const state = JSON.parse(await readFile(join(root, STATE_REL), 'utf8'));
  assert.equal(typeof state.date, 'string');
  assert.ok(['pass', 'fail', 'blocked'].includes(state.verdict));
  await assert.doesNotReject(() => readFile(join(root, '.chalc', 'gate.md'), 'utf8'));
});

test('R14 — el estado escrito por una corrida --fast lo marca', async () => {
  const root = await equipped();
  await runGate({ root, fast: true, changed: ['src/precio.ts'], run: async () => ({ code: 0, ms: 10 }) });

  const state = JSON.parse(await readFile(join(root, STATE_REL), 'utf8'));
  assert.equal(state.fast, true);
  assert.equal(state.closesTask, false);
});

test('R13 — el estado escrito coincide con lo que runGate devuelve', async () => {
  const root = await equipped();
  const result = await runGate({ root, changed: ['src/precio.ts'], run: async () => ({ code: 0, ms: 10 }) });

  const state = JSON.parse(await readFile(join(root, STATE_REL), 'utf8'));
  assert.equal(state.verdict, result.verdict);
  assert.equal(state.closesTask, result.closesTask);
});
