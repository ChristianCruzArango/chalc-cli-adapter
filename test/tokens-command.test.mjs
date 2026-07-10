// test/tokens-command.test.mjs — R4, R8, R9 de specs/002-chalc-tokens: agregado del histórico
// (por comando/tarea/modelo con USD honesto) y el comando `chalc tokens [ruta] [--json]` de punta a punta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateTokenLog } from '../lib/tokenreport.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(ROOT, 'bin/chalc.mjs');

function runChalc(args) {
  return new Promise((resolveRun) => {
    execFile(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolveRun({ code: error?.code ?? 0, stdout, output: `${stdout}${stderr}` });
    });
  });
}

// Histórico de ejemplo: modelo con precio (gpt-4o), modelo desconocido, y local gratis (ollama).
const EVENTS = [
  { ts: '2026-07-08T10:00:00Z', command: 'specgen', task: 'spec', provider: 'openai', model: 'gpt-4o', input: 1_000_000, output: 0, calls: 1 },
  { ts: '2026-07-08T10:05:00Z', command: 'qa', task: 'qa', provider: 'openai', model: 'gpt-4o', input: 0, output: 1_000_000, calls: 1 },
  { ts: '2026-07-08T10:10:00Z', command: 'qa', task: 'qa', provider: 'openrouter', model: 'vendor/desconocido-9b', input: 500, output: 500, calls: 1 },
  { ts: '2026-07-08T10:15:00Z', command: 'cli', task: 'coder', provider: 'ollama', model: 'llama3.1', input: 100, output: 100, calls: 1 }
];

test('R4: aggregateTokenLog agrega por comando, tarea y modelo con USD honesto (null si falta precio)', () => {
  const agg = aggregateTokenLog(EVENTS);
  assert.equal(agg.total.input, 1_000_600);
  assert.equal(agg.total.output, 1_000_600);
  assert.equal(agg.total.calls, 4);
  assert.equal(agg.total.usd, null);                     // hay un modelo sin precio → el total no se inventa
  assert.equal(agg.byCommand.specgen.usd, 2.5);          // 1M de entrada de gpt-4o
  assert.equal(agg.byCommand.qa.usd, null);              // mezcla gpt-4o + desconocido
  assert.equal(agg.byCommand.cli.usd, 0);                // ollama es local: $0, no "sin precio"
  assert.equal(agg.byTask.spec.usd, 2.5);
  assert.equal(agg.byTask.coder.calls, 1);
  assert.equal(agg.byModel['gpt-4o'].calls, 2);
  assert.equal(agg.byModel['gpt-4o'].usd, 12.5);         // 1M entrada ($2.5) + 1M salida ($10)
  assert.equal(agg.byModel['gpt-4o'].priced, true);
  assert.equal(agg.byModel['vendor/desconocido-9b'].priced, false);
  assert.deepEqual(agg.unpriced, ['vendor/desconocido-9b']);
});

test('R7: los precios del usuario completan lo desconocido y el total deja de ser null', () => {
  const agg = aggregateTokenLog(EVENTS, { 'desconocido-9b': { input: 2, output: 2 } });
  assert.deepEqual(agg.unpriced, []);
  assert.equal(agg.byCommand.qa.usd, 10.002);            // 1M salida gpt-4o + 1k del desconocido a $2/1M
  assert.equal(agg.total.usd, 12.502);
});

test('R8: chalc tokens sin histórico informa claro y sale con éxito', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'chalc-tokens-vacio-'));
  try {
    const r = await runChalc(['tokens', proj]);
    assert.equal(r.code, 0, r.output);
    assert.match(r.output, /Sin histórico de consumo|No spend history/);
  } finally { await rm(proj, { recursive: true, force: true }); }
});

test('R4+R9: chalc tokens muestra el desglose y --json emite el agregado parseable', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'chalc-tokens-fix-'));
  try {
    await mkdir(join(proj, '.chalc'), { recursive: true });
    await writeFile(join(proj, '.chalc', 'tokens.jsonl'), EVENTS.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const humano = await runChalc(['tokens', proj]);
    assert.equal(humano.code, 0, humano.output);
    assert.match(humano.output, /gpt-4o/);
    assert.match(humano.output, /specgen/);
    assert.match(humano.output, /vendor\/desconocido-9b/);   // lo sin precio se señala, no se oculta
    const json = await runChalc(['tokens', proj, '--json']);
    assert.equal(json.code, 0, json.output);
    const agg = JSON.parse(json.stdout);                     // stdout limpio: solo JSON (R9)
    assert.equal(agg.total.calls, 4);
    assert.equal(agg.byModel['gpt-4o'].usd, 12.5);
  } finally { await rm(proj, { recursive: true, force: true }); }
});

test('R4: el alias `chalc gasto` llega al mismo comando', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'chalc-tokens-alias-'));
  try {
    const r = await runChalc(['gasto', proj]);
    assert.equal(r.code, 0, r.output);
    assert.match(r.output, /Sin histórico de consumo|No spend history/);
  } finally { await rm(proj, { recursive: true, force: true }); }
});
