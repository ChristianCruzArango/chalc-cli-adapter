// test/tokenlog-e2e.test.mjs — R2 de specs/002-chalc-tokens de punta a punta: un comando real del
// bin (spec-ia) contra una IA simulada deja el histórico en <proyecto>/.chalc/tokens.jsonl.
// Se prueba el camino de ERROR a propósito (la IA responde basura y el comando sale 1): es la
// cláusula fuerte de R2 — el gasto se persiste aunque el comando falle DESPUÉS de pagar tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(ROOT, 'bin/chalc.mjs');

function runChalc(args, env) {
  return new Promise((resolveRun) => {
    execFile(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      resolveRun({ code: error?.code ?? 0, output: `${stdout}${stderr}` });
    });
  });
}

test('R2: spec-ia persiste el histórico en .chalc/tokens.jsonl del proyecto aunque la IA falle', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'chalc-e2e-tokens-'));
  const docDir = await mkdtemp(join(tmpdir(), 'chalc-e2e-doc-'));
  // IA simulada OpenAI-compatible: cobra tokens pero responde basura (sin ===SPEC===) → el comando falla
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'respuesta sin marcas' } }], usage: { prompt_tokens: 33, completion_tokens: 7 } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const doc = join(docDir, 'hu.md');
    await writeFile(doc, 'HU: como usuario quiero ver mi consumo para ahorrar.');
    const r = await runChalc(['spec-ia', proj, '--doc', doc, '--lang', 'es'], {
      CHALC_PROVIDER: 'openai',
      CHALC_API_KEY: 'clave-falsa',
      CHALC_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
      CHALC_MODEL: 'gpt-4o'
    });
    assert.equal(r.code, 1, r.output);   // la IA no devolvió spec → error limpio
    const logFile = join(proj, '.chalc', 'tokens.jsonl');
    assert.ok(existsSync(logFile), `debe existir ${logFile}\n${r.output}`);
    const events = (await readFile(logFile, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(events.length, 1);
    assert.equal(events[0].command, 'specgen');
    assert.equal(events[0].task, 'spec');
    assert.equal(events[0].provider, 'openai');
    assert.equal(events[0].model, 'gpt-4o');
    assert.equal(events[0].input, 33);
    assert.equal(events[0].output, 7);
  } finally {
    server.close();
    await rm(proj, { recursive: true, force: true });
    await rm(docDir, { recursive: true, force: true });
  }
});
