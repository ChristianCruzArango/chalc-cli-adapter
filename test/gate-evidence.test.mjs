// T22 (R9) — `.chalc/gate.md`, la evidencia de la corrida.
//
// Este archivo es lo que convierte el portón en algo verificable por un humano: fecha, rama, cada
// comando con su código de salida y su duración REALES, el score, los sobrevivientes, los hallazgos
// y el veredicto. Si algo de eso falta, volvemos a depender de que alguien cuente bien lo que hizo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderEvidence, verdictOf, writeEvidence } from '../catalog/gate/lib/evidence.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';

const DATE = new Date(2026, 7, 6, 14, 32);

const meta = (over = {}) => ({ date: DATE, branch: 'feature/007-carrito', role: 'back', spec: 'specs/007-carrito', ...over });

const passed = (stage, command, ms) => ({ stage, ok: true, blocked: false, command, code: 0, ms, findings: [] });

const render = (stages, lang = 'es') => renderEvidence({ stages, meta: meta(), lang });

// ── cabecera ──────────────────────────────────────────────────────────────────────────────────

test('renderEvidence opens with the date, the branch, the role and the spec', async () => {
  const md = renderEvidence({ stages: [passed('tests', 'npm test', 12300)], meta: meta(), lang: 'es' });

  assert.match(md, /2026-08-06 14:32/);
  assert.match(md, /feature\/007-carrito/);
  assert.match(md, /back/);
  assert.match(md, /specs\/007-carrito/);
});

// ── etapas ────────────────────────────────────────────────────────────────────────────────────

test('renderEvidence lists every command with its real exit code and duration', async () => {
  const md = renderEvidence({
    stages: [
      passed('tests', 'npm test', 12300),
      { stage: 'mutation', ok: false, blocked: true, reason: 'no-report', command: 'npx stryker run', code: 1, ms: 45000, findings: [] }
    ],
    meta: meta(),
    lang: 'es'
  });

  assert.match(md, /`npm test`/);
  assert.match(md, /12\.3 s/, 'la duración se muestra, no se redondea a nada');
  assert.match(md, /`npx stryker run`/);
  assert.match(md, /45\.0 s/);
  // El código de salida real es la mitad de la evidencia: sin él, "falló" es una opinión.
  assert.match(md, /\|\s*1\s*\|/);
});

test('renderEvidence shows a dash for a stage that runs no command', async () => {
  const md = render([{ stage: 'smells', ok: true, blocked: false, command: '', code: null, ms: 240, findings: [] }]);

  assert.match(md, /240 ms/);
  assert.match(md, /—/);
});

// ── mutación ──────────────────────────────────────────────────────────────────────────────────

test('renderEvidence reports the score, the threshold and every survivor', async () => {
  const md = render([{
    stage: 'mutation', ok: false, blocked: false, command: 'npx stryker run', code: 0, ms: 45000,
    score: 62, threshold: 80, killed: 13,
    survivors: [
      { file: 'src/precio.ts', line: 12, mutator: 'ArithmeticOperator', status: 'Survived' },
      { file: 'src/total.ts', line: 40, mutator: 'ConditionalExpression', status: 'NoCoverage' }
    ],
    findings: []
  }]);

  assert.match(md, /62/);
  assert.match(md, /80/);
  assert.match(md, /src\/precio\.ts/);
  assert.match(md, /ArithmeticOperator/);
  assert.match(md, /NoCoverage/);
});

// ── hallazgos ─────────────────────────────────────────────────────────────────────────────────

test('renderEvidence writes each finding with file, line and the sentence in the spec language', async () => {
  const stages = [{
    stage: 'smells', ok: false, blocked: false, command: '', code: null, ms: 200,
    findings: [{ file: 'src/precio.ts', line: 12, rule: RULES.fileTooLong, data: { lines: 412, limit: 300 } }]
  }];

  const es = renderEvidence({ stages, meta: meta(), lang: 'es' });
  const en = renderEvidence({ stages, meta: meta(), lang: 'en' });

  for (const md of [es, en]) {
    assert.match(md, /src\/precio\.ts/);
    assert.match(md, /\|\s*12\s*\|/);
    assert.match(md, /412/);
  }
  assert.match(es, /líneas/);
  assert.match(en, /lines/);
  assert.notEqual(es, en, 'el marco entero cambia de idioma, no solo los hallazgos');
});

test('renderEvidence says so when there is nothing to report', async () => {
  const md = render([passed('tests', 'npm test', 900)]);

  assert.match(md, /Sin hallazgos/);
});

// ── veredicto ─────────────────────────────────────────────────────────────────────────────────

test('verdictOf blocks when any stage could not be verified', async () => {
  const stages = [passed('tests', 'npm test', 900), { stage: 'mutation', ok: false, blocked: true, reason: 'no-report', findings: [] }];

  assert.equal(verdictOf(stages), 'blocked');
  assert.match(render(stages), /BLOQUEADO/);
});

test('verdictOf fails when a stage ran and did not pass', async () => {
  const stages = [passed('tests', 'npm test', 900), { stage: 'smells', ok: false, blocked: false, findings: [] }];

  assert.equal(verdictOf(stages), 'fail');
  assert.match(render(stages), /NO PASA/);
});

test('verdictOf passes only when every stage that ran passed', async () => {
  const stages = [passed('tests', 'npm test', 900), passed('smells', '', 200)];

  assert.equal(verdictOf(stages), 'pass');
  assert.match(render(stages), /APROBADO/);
});

// Una etapa OMITIDA nunca tumba el veredicto, sea cual sea su `ok`: no se ejecutó, así que no puede
// opinar. Hoy todas las omisiones se construyen con `ok: true` y la distinción no se nota; el día que
// alguien añada una omisión en rojo —"saltada porque la anterior falló"— esto evita que un veredicto
// cambie de golpe sin que nadie lo haya decidido.
test('verdictOf never lets a skipped stage decide the verdict', async () => {
  const stages = [
    passed('tests', 'npm test', 900),
    { stage: 'mutation', ok: false, blocked: false, skipped: true, reason: 'fast', findings: [] }
  ];

  assert.equal(verdictOf(stages), 'pass');
});

// Un bloqueo pesa más que un fallo: "no pude comprobarlo" y "lo comprobé y está mal" se arreglan
// de formas distintas, y el veredicto tiene que decir cuál de las dos es.
test('verdictOf prefers blocked over failed when both happen', async () => {
  const stages = [
    { stage: 'tests', ok: false, blocked: false, findings: [] },
    { stage: 'mutation', ok: false, blocked: true, reason: 'not-installed', findings: [] }
  ];

  assert.equal(verdictOf(stages), 'blocked');
});

// ── etapas omitidas ───────────────────────────────────────────────────────────────────────────

test('renderEvidence marks a fast run as not valid to close the task', async () => {
  const md = render([
    passed('tests', 'npm test', 900),
    { stage: 'mutation', ok: true, blocked: false, skipped: true, reason: 'fast', findings: [] }
  ]);

  assert.match(md, /--fast/);
  assert.match(md, /no cierra la tarea/i);
});

test('renderEvidence marks mutation as not run when the tests failed', async () => {
  const md = render([
    { stage: 'tests', ok: false, blocked: false, command: 'npm test', code: 1, ms: 4000, findings: [] },
    { stage: 'mutation', ok: true, blocked: false, skipped: true, reason: 'tests-failed', findings: [] }
  ]);

  assert.match(md, /los tests fallaron/);
});

test('renderEvidence marks a stage the repo declared not applicable', async () => {
  const md = render([
    passed('tests', 'flutter test', 8000),
    { stage: 'mutation', ok: true, blocked: false, skipped: true, reason: 'not-required', findings: [] }
  ]);

  assert.match(md, /no aplica/);
});

// ── escritura ─────────────────────────────────────────────────────────────────────────────────

test('writeEvidence leaves the report at .chalc/gate.md', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-evidence-'));

  const path = await writeEvidence(dir, '# informe\n');

  assert.equal(path, '.chalc/gate.md');
  assert.equal(await readFile(join(dir, '.chalc', 'gate.md'), 'utf8'), '# informe\n');
});
