// test/tokenlog.test.mjs — histórico persistente de consumo IA (R1, R2, R3 de specs/002-chalc-tokens):
// cada llamada queda en un buffer con sus metadatos y se persiste UNA vez en .chalc/tokens.jsonl,
// best-effort (jamás rompe un comando que ya pagó tokens).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logAiCall, setTokenLogCommand, setTokenLogProject, flushTokenLog, readTokenLog, resetTokenLog } from '../lib/tokenlog.mjs';

const makeRoot = () => mkdtemp(join(tmpdir(), 'chalc-tokenlog-'));
const LOG_REL = join('.chalc', 'tokens.jsonl');

test('R1: logAiCall registra fecha, comando, tarea, proveedor, modelo y tokens normalizados', async () => {
  resetTokenLog();
  const root = await makeRoot();
  try {
    setTokenLogCommand('specgen');
    // usage estilo OpenAI-compatible y estilo Anthropic: ambos deben normalizar igual (reuso de tokenmeter)
    logAiCall({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6', task: 'spec' }, { prompt_tokens: 100, completion_tokens: 20 });
    logAiCall({ provider: 'anthropic', model: 'claude-sonnet-4-6' }, { input_tokens: 7, output_tokens: 3 });
    await flushTokenLog(root);
    const events = await readTokenLog(root);
    assert.equal(events.length, 2);
    assert.equal(events[0].command, 'specgen');
    assert.equal(events[0].task, 'spec');
    assert.equal(events[0].provider, 'openrouter');
    assert.equal(events[0].model, 'anthropic/claude-sonnet-4.6');
    assert.equal(events[0].input, 100);
    assert.equal(events[0].output, 20);
    assert.equal(events[0].calls, 1);
    assert.ok(!Number.isNaN(Date.parse(events[0].ts)), 'ts debe ser fecha ISO parseable');
    assert.equal(events[1].task, 'default');   // sin tarea explícita → default
    assert.equal(events[1].input, 7);
  } finally { await rm(root, { recursive: true, force: true }); resetTokenLog(); }
});

test('R2: el flush es append-only y vacía el buffer (un 2º flush sin eventos nuevos devuelve null)', async () => {
  resetTokenLog();
  const root = await makeRoot();
  try {
    logAiCall({ provider: 'openai', model: 'gpt-4o', task: 'qa' }, { prompt_tokens: 10, completion_tokens: 5 });
    const file = await flushTokenLog(root);
    assert.equal(file, join(root, LOG_REL));
    assert.equal(await flushTokenLog(root), null);   // buffer ya vacío: no escribe ni duplica
    logAiCall({ provider: 'openai', model: 'gpt-4o', task: 'repair' }, { prompt_tokens: 1, completion_tokens: 1 });
    await flushTokenLog(root);
    const lines = (await readFile(join(root, LOG_REL), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);   // corrida anterior intacta + evento nuevo
  } finally { await rm(root, { recursive: true, force: true }); resetTokenLog(); }
});

test('R3: flush best-effort — destino no escribible o ausente devuelve null sin lanzar', async () => {
  resetTokenLog();
  const root = await makeRoot();
  try {
    logAiCall({ provider: 'openai', model: 'gpt-4o' }, { prompt_tokens: 1, completion_tokens: 1 });
    // .chalc existe como ARCHIVO: mkdir/append fallan — el comando no debe romperse
    await writeFile(join(root, '.chalc'), 'no soy una carpeta');
    assert.equal(await flushTokenLog(root), null);
    assert.equal(await flushTokenLog(''), null);      // sin ruta de proyecto tampoco lanza
    assert.equal(await flushTokenLog(null), null);
  } finally { await rm(root, { recursive: true, force: true }); resetTokenLog(); }
});

test('R2: setTokenLogProject fija el proyecto REAL y gana al fallback del flush', async () => {
  resetTokenLog();
  const real = await makeRoot();      // el proyecto que el comando resolvió por dentro (spec-ia, feature, init)
  const fallback = await makeRoot();  // el projectPath del contexto del bin (bogus para esos verbos)
  try {
    logAiCall({ provider: 'openai', model: 'gpt-4o', task: 'spec' }, { prompt_tokens: 1, completion_tokens: 1 });
    setTokenLogProject(real);
    assert.equal(await flushTokenLog(fallback), join(real, LOG_REL));   // el proyecto explícito gana
    assert.equal((await readTokenLog(real)).length, 1);
    assert.deepEqual(await readTokenLog(fallback), []);
    // sin proyecto explícito, el fallback del flush sí aplica (qa/deliver/apply)
    logAiCall({ provider: 'openai', model: 'gpt-4o', task: 'qa' }, { prompt_tokens: 2, completion_tokens: 2 });
    resetTokenLog();   // borra proyecto explícito y buffer…
    logAiCall({ provider: 'openai', model: 'gpt-4o', task: 'qa' }, { prompt_tokens: 2, completion_tokens: 2 });
    assert.equal(await flushTokenLog(fallback), join(fallback, LOG_REL));
  } finally {
    await rm(real, { recursive: true, force: true });
    await rm(fallback, { recursive: true, force: true });
    resetTokenLog();
  }
});

test('R1: logAiCall nunca lanza, ni con metadatos o usage basura', () => {
  resetTokenLog();
  assert.doesNotThrow(() => logAiCall());
  assert.doesNotThrow(() => logAiCall(null, null));
  assert.doesNotThrow(() => logAiCall({ model: 42 }, 'basura'));
  resetTokenLog();
});

test('readTokenLog: sin histórico devuelve [] y las líneas corruptas se saltan', async () => {
  resetTokenLog();
  const root = await makeRoot();
  try {
    assert.deepEqual(await readTokenLog(root), []);   // no existe el archivo aún
    logAiCall({ provider: 'ollama', model: 'llama3.1', task: 'cli' }, { prompt_tokens: 2, completion_tokens: 2 });
    await flushTokenLog(root);
    // se corrompe el archivo a mano (mitad de línea, texto suelto): el reporte no puede reventar
    const file = join(root, LOG_REL);
    await writeFile(file, (await readFile(file, 'utf8')) + '{"ts": trunc\nbasura sin json\n', 'utf8');
    const events = await readTokenLog(root);
    assert.equal(events.length, 1);
    assert.equal(events[0].model, 'llama3.1');
  } finally { await rm(root, { recursive: true, force: true }); resetTokenLog(); }
});
