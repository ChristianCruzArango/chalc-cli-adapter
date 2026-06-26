import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentReplaySpec, buildRepairPlanMarkdown, buildResultsMarkdown, httpExecutor, normalizeVerdicts, parseAgentMessage, parseResultsMarkdown, runQaAgent } from '../lib/qaagent.mjs';

test('buildAgentReplaySpec emits ONE test per requirement, grouping its verified steps', () => {
  const steps = [
    { step: 1, action: { type: 'browser', requirement: 'R1', steps: [{ op: 'goto', url: '/' }, { op: 'expectText', selector: 'body', value: 'Bienvenido' }] }, observation: { ok: true } },
    { step: 2, action: { type: 'browser', requirement: 'R1', steps: [{ op: 'clickByRole', role: 'button', name: 'Entrar' }] }, observation: { ok: true } },
    { step: 3, action: { type: 'browser', requirement: 'R2', steps: [{ op: 'expectUrl', value: '/home' }] }, observation: { ok: true } },
    { step: 4, action: { type: 'http' }, observation: { ok: true } }   // no-browser: se ignora
  ];
  const spec = buildAgentReplaySpec('001-home', 'http://localhost:4200', steps, { R1: 'La home saluda', R2: 'Redirige al home' });
  assert.equal((spec.match(/\btest\('/g) || []).length, 2);                // un test por requisito (R1, R2)
  assert.match(spec, /test\.describe\.configure\(\{ mode: 'serial' \}\)/); // sesión compartida (mismo proceso)
  assert.match(spec, /test\.beforeAll/);
  assert.match(spec, /test\('R1 — La home saluda', async \(\) =>/);        // sin fixture {page}: usa la compartida
  assert.match(spec, /test\('R2 — Redirige al home'/);
  assert.match(spec, /page\.goto\("http:\/\/localhost:4200\/"\)/);
  assert.match(spec, /getByRole\("button", \{ name: "Entrar" \}\)\.click\(\)/);   // ambos pasos de R1 en su test
  assert.match(buildAgentReplaySpec('x', 'http://x', []), /test\.fixme/);
});

test('parseAgentMessage strips fences and extracts the JSON object', () => {
  assert.deepEqual(parseAgentMessage('```json\n{"done":true,"verdicts":[]}\n```'), { done: true, verdicts: [] });
  assert.deepEqual(parseAgentMessage('aquí va: {"done":false} listo'), { done: false });
  assert.throws(() => parseAgentMessage('sin json'), SyntaxError);
});

test('normalizeVerdicts guarantees one verdict per requirement and normalizes status/id', () => {
  const out = normalizeVerdicts([{ id: 'r1', status: 'pass', evidence: 'ok' }, { id: 'R2', status: 'weird' }], ['R1', 'R2', 'R3']);
  assert.deepEqual(out, [
    { id: 'R1', status: 'PASS', evidence: 'ok' },
    { id: 'R2', status: 'BLOCKED', evidence: '' },
    { id: 'R3', status: 'BLOCKED', evidence: 'El agente no emitió veredicto para este requisito.' }
  ]);
});

test('normalizeVerdicts accepts NOT_APPLICABLE only when explicitly emitted', () => {
  const out = normalizeVerdicts([{ id: 'R1', status: 'not_applicable', evidence: 'No surface externa.' }], ['R1']);
  assert.equal(out[0].status, 'NOT_APPLICABLE');
});

test('httpExecutor reports deterministic ok based on the expected status', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 200, text: async () => '{"token":"ey"}' }; };
  const exec = httpExecutor('http://localhost:3000/', { fetchImpl, allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'POST'] });

  const ok = await exec({ type: 'http', method: 'POST', path: '/auth/login', body: { a: 1 }, expect: { status: 200 } });
  assert.equal(ok.ok, true);
  assert.equal(ok.status, 200);
  assert.equal(ok.request, 'POST /auth/login');
  assert.equal(calls[0].url, 'http://localhost:3000/auth/login');
  assert.equal(calls[0].init.body, '{"a":1}');

  const mismatch = await exec({ type: 'http', path: '/x', expect: { status: 201 } });
  assert.equal(mismatch.ok, false);

  const wrongType = await exec({ type: 'browser' });
  assert.equal(wrongType.ok, false);
  assert.match(wrongType.error, /no soportada en api/);
});

test('httpExecutor preserves large evidence for CCR instead of truncating it', async () => {
  const body = 'x'.repeat(150_000);
  const exec = httpExecutor('http://localhost:3000', { fetchImpl: async () => ({ status: 200, text: async () => body }) });
  assert.equal((await exec({ type: 'http', path: '/large' })).body.length, body.length);
});

test('httpExecutor blocks writes and routes outside the QA policy', async () => {
  const exec = httpExecutor('http://localhost:3000', { fetchImpl: async () => ({ status: 200, text: async () => '' }), allowedPaths: ['/public'] });
  assert.match((await exec({ type: 'http', method: 'POST', path: '/public' })).error, /no autorizado/);
  assert.match((await exec({ type: 'http', method: 'GET', path: '/private' })).error, /ruta no autorizada/);
});

test('httpExecutor injects the QA session headers and lets per-action headers override', async () => {
  let seen = null;
  const exec = httpExecutor('http://localhost:3000', {
    fetchImpl: async (_url, init) => { seen = init.headers; return { status: 200, text: async () => '' }; },
    headers: { Authorization: 'Bearer SESSION' }
  });
  await exec({ type: 'http', path: '/me', headers: { 'x-extra': '1' } });
  assert.equal(seen.Authorization, 'Bearer SESSION');
  assert.equal(seen['x-extra'], '1');
});

test('runQaAgent loops: executes proposed actions, then returns normalized verdicts', async () => {
  const scripted = [
    '{"done":false,"thought":"probar R1","action":{"type":"http","method":"GET","path":"/health","expect":{"status":200}}}',
    '{"done":true,"verdicts":[{"id":"R1","status":"PASS","evidence":"GET /health 200"}]}'
  ];
  let turn = 0;
  const chatImpl = async () => scripted[turn++];
  const executed = [];
  const executor = async (action) => { executed.push(action); return { ok: true, status: 200 }; };

  const result = await runQaAgent({ surface: 'api', baseUrl: 'http://localhost:3000', plan: '- R1', requirementIds: ['R1', 'R2'], chatImpl, executor, maxSteps: 5 });

  assert.equal(executed.length, 1);
  assert.equal(executed[0].path, '/health');
  assert.deepEqual(result.verdicts, [
    { id: 'R1', status: 'PASS', evidence: 'GET /health 200' },
    { id: 'R2', status: 'BLOCKED', evidence: 'El agente no emitió veredicto para este requisito.' }
  ]);
});

test('buildResultsMarkdown renders one traceable row per verdict and escapes pipes', () => {
  const md = buildResultsMarkdown('001-login', {
    surface: 'api', baseUrl: 'http://localhost:3000',
    result: { steps: [{}], error: null, verdicts: [{ id: 'R1', status: 'PASS', evidence: 'a | b' }] }
  });
  assert.match(md, /# Resultados QA — 001-login/);
  assert.match(md, /Superficie: \*\*api\*\*/);
  assert.match(md, /\| R1 \| PASS \| a \\\| b \|/);
});

test('repair plan is generated only from FAIL/BLOCKED QA verdicts', () => {
  const result = {
    verdicts: [
      { id: 'R1', status: 'PASS', evidence: 'ok' },
      { id: 'R2', status: 'FAIL', evidence: 'expected a | got b' },
      { id: 'R3', status: 'BLOCKED', evidence: 'missing token' }
    ]
  };
  const md = buildRepairPlanMarkdown('001-login', { result, requirementTexts: { R2: 'Login visible' }, generatedAt: '2026-06-26T00:00:00.000Z' });
  assert.match(md, /R2 — Login visible/);
  assert.match(md, /R3/);
  assert.doesNotMatch(md, /R1.*PASS/);
});

test('parseResultsMarkdown reconstructs verdict rows from qa results', () => {
  const parsed = parseResultsMarkdown('| Requisito | Estado | Evidencia |\n|---|---|---|\n| R1 | FAIL | a \\| b |\n');
  assert.deepEqual(parsed.verdicts, [{ id: 'R1', status: 'FAIL', evidence: 'a | b' }]);
});

test('runQaAgent compacts bulky observations with CCR and serves recall from cache (no extra executor call)', async () => {
  const bigBody = 'Z'.repeat(2000);
  const scripted = [
    '{"done":false,"thought":"traer datos para R1","action":{"type":"http","method":"GET","path":"/data"}}',
    '{"done":false,"thought":"necesito el cuerpo completo","action":{"type":"recall","ref":"c1"}}',
    '{"done":false,"thought":"un paso más","action":{"type":"http","method":"GET","path":"/small"}}',
    '{"done":true,"verdicts":[{"id":"R1","status":"PASS","evidence":"cuerpo recuperado por CCR"}]}'
  ];
  let turn = 0;
  const seenObservations = [];
  const chatImpl = async (_cfg, { system }) => { seenObservations.push(system); return scripted[turn++]; };
  let executorCalls = 0;
  const executor = async () => { executorCalls += 1; return executorCalls === 1 ? { ok: true, status: 200, body: bigBody } : { ok: true, status: 200, body: 'ok' }; };

  const result = await runQaAgent({ surface: 'api', baseUrl: 'http://x', plan: '- R1', requirementIds: ['R1'], chatImpl, executor, maxSteps: 6 });

  assert.equal(executorCalls, 2);                                  // recall NO golpea el executor
  assert.match(seenObservations[1], /\[CCR ref=c1/);              // el cuerpo grande viajó comprimido al prompt
  assert.ok(!seenObservations[1].includes(bigBody));              // el original NO estaba inline
  const recallStep = result.steps.find((s) => s.action?.type === 'recall');
  assert.equal(recallStep.observation.content, bigBody);          // recall devolvió el original entero
  assert.ok(seenObservations[2].includes(bigBody));               // entero solo en el turno inmediato posterior
  assert.ok(!seenObservations[3].includes(bigBody));              // luego CCR lo difiere otra vez
  assert.equal(result.verdicts[0].status, 'PASS');
  assert.ok(result.ccr.entries >= 1);
});

test('runQaAgent stops on invalid JSON and on step exhaustion, never fabricating a PASS', async () => {
  const bad = await runQaAgent({ surface: 'api', baseUrl: 'x', plan: 'p', requirementIds: ['R1'], chatImpl: async () => 'not json', executor: async () => ({}) });
  assert.match(bad.error, /JSON inválido/);
  assert.equal(bad.verdicts[0].status, 'BLOCKED');

  const looping = '{"done":false,"thought":"otra vez","action":{"type":"http","path":"/x"}}';
  const exhausted = await runQaAgent({ surface: 'api', baseUrl: 'x', plan: 'p', requirementIds: ['R1'], chatImpl: async () => looping, executor: async () => ({ ok: true }), maxSteps: 3 });
  assert.match(exhausted.error, /agotaron los 3 pasos/);
  assert.equal(exhausted.steps.length, 3);
  assert.equal(exhausted.verdicts[0].status, 'BLOCKED');
});
