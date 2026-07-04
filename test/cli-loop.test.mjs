import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../cli/engine/loop.mjs';

// renderPrompt trivial: el motor no depende del texto del harness, así que el test inyecta uno mínimo.
const renderPrompt = ({ stepsLeft, retry }) => ({ system: 'sys', user: `left=${stepsLeft} ${retry}` });

// chatImpl guionizado: devuelve el turno crudo n-ésimo de una lista. Simula al modelo sin gastar tokens.
function scripted(turns) {
  let i = 0;
  return async () => turns[Math.min(i++, turns.length - 1)];
}

test('runAgent exige chatImpl y renderPrompt', async () => {
  await assert.rejects(() => runAgent({ renderPrompt }), /chatImpl/);
  await assert.rejects(() => runAgent({ chatImpl: async () => '' }), /renderPrompt/);
});

test('runAgent ejecuta una acción y registra la observación', async () => {
  const calls = [];
  const tools = { read: { summary: 'lee', run: async (args) => { calls.push(args); return { content: 'hola' }; } } };
  const chatImpl = scripted([
    '{"thought":"leer","action":{"tool":"read","args":{"path":"a.js"}}}',
    '{"done":true,"summary":"listo"}'
  ]);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.equal(r.done, true);
  assert.equal(r.summary, 'listo');
  assert.equal(r.steps.length, 1);
  assert.deepEqual(calls, [{ path: 'a.js' }]);
  assert.deepEqual(r.steps[0].observation, { content: 'hola' });
});

test('runAgent comprime observaciones voluminosas con CCR y las recupera con recall', async () => {
  const big = 'X'.repeat(2000);
  const tools = { cat: { summary: 'cat', run: async () => ({ body: big }) } };
  const chatImpl = scripted([
    '{"action":{"tool":"cat","args":{}}}',
    '{"action":{"tool":"recall","args":{"ref":"c1"}}}',
    '{"done":true,"summary":"ok"}'
  ]);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  // La observación grande quedó como referencia CCR (placeholder), no como texto de 2000 chars.
  assert.match(r.steps[0].observation.body, /\[CCR ref=c1/);
  // El recall trajo de vuelta el contenido íntegro.
  assert.equal(r.steps[1].observation.content, big);
  assert.ok(r.ccr.entries >= 1);
});

test('runAgent con ccr:false no comprime', async () => {
  const big = 'Y'.repeat(2000);
  const tools = { cat: { summary: 'cat', run: async () => ({ body: big }) } };
  const chatImpl = scripted(['{"action":{"tool":"cat","args":{}}}', '{"done":true,"summary":"ok"}']);
  const r = await runAgent({ chatImpl, tools, renderPrompt, ccr: false });
  assert.equal(r.steps[0].observation.body, big);
  assert.equal(r.ccr, null);
});

test('runAgent devuelve una observación de error ante una herramienta desconocida (no lanza)', async () => {
  const chatImpl = scripted(['{"action":{"tool":"nope","args":{}}}', '{"done":true,"summary":"ok"}']);
  const r = await runAgent({ chatImpl, tools: {}, renderPrompt });
  assert.match(r.steps[0].observation.error, /unknown tool: nope/);
});

test('runAgent NO auto-resuelve nombres cortos inventados por contención ("sh" no es bash)', async () => {
  const calls = [];
  const tools = {
    bash: { summary: 'x', run: async () => { calls.push('bash'); return { ok: true }; } },
    edit: { summary: 'x', run: async () => { calls.push('edit'); return { ok: true }; } }
  };
  const chatImpl = scripted(['{"action":{"tool":"sh","args":{}}}', '{"done":true,"summary":"ok"}']);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.match(r.steps[0].observation.error, /unknown tool: sh/);
  assert.deepEqual(calls, []);   // no se ejecuta NINGUNA tool con un nombre que el modelo no escribió
});

test('runAgent NO re-ejecuta una acción idéntica ya exitosa (anti-bucle) y guía al modelo', async () => {
  let executions = 0;
  const tools = { fetch: { summary: 'f', run: async () => { executions++; return { text: 'dato' }; } } };
  const chatImpl = scripted([
    '{"action":{"tool":"fetch","args":{"q":"x"}}}',
    '{"action":{"tool":"fetch","args":{"q":"x"}}}',   // repite la MISMA acción
    '{"done":true,"summary":"ok"}'
  ]);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.equal(executions, 1, 'la segunda llamada idéntica no re-ejecuta el tool');
  assert.equal(r.steps[1].observation.repeated, true);
  assert.match(r.steps[1].observation.note, /step 1/);
  assert.match(r.steps[1].observation.note, /recall/);
});

test('runAgent corta el turno si el modelo repite 3 veces la MISMA acción fallida (bucle)', async () => {
  // Reproduce el caso real: el modelo trunca el nombre MCP y lo repite ignorando la corrección.
  const tools = { 'mcp__cli__list_projects': { summary: 'x', run: async () => ({ ok: true }) }, 'mcp__cli__generate': { summary: 'y', run: async () => ({ ok: true }) } };
  const chatImpl = scripted([
    '{"action":{"tool":"mcp__cli","args":{}}}',
    '{"action":{"tool":"mcp__cli","args":{}}}',
    '{"action":{"tool":"mcp__cli","args":{}}}',
    '{"action":{"tool":"mcp__cli","args":{}}}'
  ]);
  const r = await runAgent({ chatImpl, tools, renderPrompt, maxSteps: 12 });
  assert.equal(r.done, false);
  assert.match(r.error, /bucle detectado/);
  assert.equal(r.steps.length, 2);   // 2 fallos registrados; el 3º corta sin quemar los 12 pasos
  // y el error del nombre truncado trae un ejemplo copiable del nombre completo
  assert.match(r.steps[0].observation.error, /FULL exact name, e\.g\. "mcp__cli__/);
});

test('runAgent SÍ permite repetir una acción cuyo intento anterior falló', async () => {
  let n = 0;
  const tools = { flaky: { summary: 'f', run: async () => (++n === 1 ? { error: 'temporal' } : { ok: true }) } };
  const chatImpl = scripted([
    '{"action":{"tool":"flaky","args":{}}}',
    '{"action":{"tool":"flaky","args":{}}}',   // reintento legítimo tras error
    '{"done":true,"summary":"ok"}'
  ]);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.equal(n, 2, 'el reintento tras error sí se ejecuta');
  assert.equal(r.steps[1].observation.ok, true);
});

test('runAgent auto-resuelve un nombre truncado cuando coincide con UNA sola tool', async () => {
  const calls = [];
  const tools = { 'mcp__angular-cli__list_projects': { summary: 'x', run: async () => { calls.push(1); return { ok: true }; } } };
  const chatImpl = scripted(['{"action":{"tool":"mcp__angular-cli","args":{}}}', '{"done":true,"summary":"ok"}']);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.equal(calls.length, 1, 'la tool se ejecutó pese al nombre truncado');
  assert.equal(r.steps[0].action.tool, 'mcp__angular-cli__list_projects');   // registra el nombre RESUELTO
  assert.equal(r.steps[0].observation.ok, true);
});

test('runAgent escala la corrección en la 2ª repetición idéntica de un nombre desconocido', async () => {
  const tools = {
    'mcp__ng__list_projects': { summary: 'x', run: async () => ({ ok: true }) },
    'mcp__ng__get_best_practices': { summary: 'y', run: async () => ({ ok: true }) }
  };
  const chatImpl = scripted([
    '{"action":{"tool":"mcp__ng","args":{}}}',
    '{"action":{"tool":"mcp__ng","args":{}}}',
    '{"done":true,"summary":"ok"}'
  ]);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.doesNotMatch(r.steps[0].observation.error, /YA fallaste/);   // 1er intento: corrección normal
  assert.match(r.steps[1].observation.error, /ALREADY failed with this SAME name/);   // 2º: escalada
  assert.match(r.steps[1].observation.error, /another tool/);
});

test('runAgent redirige a las alternativas reales cuando el modelo INVENTA una tool', async () => {
  const tools = {
    'mcp__ng__list_projects': { summary: 'x', run: async () => ({ ok: true }) },
    bash: { summary: 'sh', run: async () => ({ ok: true }) }
  };
  const chatImpl = scripted(['{"action":{"tool":"mcp__ng__generate","args":{}}}', '{"done":true,"summary":"ok"}']);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.match(r.steps[0].observation.error, /does NOT exist/);
  assert.match(r.steps[0].observation.error, /do it with bash/);   // solo alternativas que EXISTEN aquí
  assert.ok(r.steps[0].observation.available.includes('bash'));
});

test('runAgent en rol de SOLO LECTURA reencauza write/edit/bash hacia el entregable (done)', async () => {
  // El caso real: durante /plan, el planner (solo read/list/grep) intenta EJECUTAR la tarea con write.
  const tools = {
    read: { summary: 'lee', run: async () => ({ content: 'x' }) },
    list: { summary: 'lista', run: async () => ({ entries: [] }) }
  };
  const chatImpl = scripted(['{"action":{"tool":"write","args":{"path":"a.ts","content":"x"}}}', '{"done":true,"summary":"1. plan"}']);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.match(r.steps[0].observation.error, /READ-ONLY/);
  assert.match(r.steps[0].observation.error, /"done"/);              // le recuerda cuál es su entregable
  assert.doesNotMatch(r.steps[0].observation.error, /do it with/);    // NO sugiere herramientas que no existen
  assert.equal(r.done, true);
});

test('runAgent resuelve por SUFIJO cuando el modelo omite el prefijo del server', async () => {
  const calls = [];
  const tools = {
    'mcp__angular-cli__get_best_practices': { summary: 'x', run: async () => { calls.push(1); return { ok: true }; } },
    'mcp__angular-cli__list_projects': { summary: 'y', run: async () => ({ ok: true }) }
  };
  const chatImpl = scripted(['{"action":{"tool":"get_best_practices","args":{}}}', '{"done":true,"summary":"ok"}']);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.equal(calls.length, 1);
  assert.equal(r.steps[0].action.tool, 'mcp__angular-cli__get_best_practices');
});

test('runAgent desambigua "mcp__<server>" por las claves de los args (argHints)', async () => {
  // El caso real: el modelo escribe solo el prefijo del server pero manda {query: ...} — solo
  // search_documentation acepta "query", así que se resuelve a esa.
  const calls = [];
  const tools = {
    'mcp__angular-cli__search_documentation': { summary: 'x', argHints: ['query', 'version'], run: async (a) => { calls.push(a); return { ok: true }; } },
    'mcp__angular-cli__get_best_practices': { summary: 'y', argHints: [], run: async () => ({ ok: true }) },
    'mcp__angular-cli__list_projects': { summary: 'z', argHints: [], run: async () => ({ ok: true }) }
  };
  const chatImpl = scripted(['{"action":{"tool":"mcp__angular-cli","args":{"query":"signals"}}}', '{"done":true,"summary":"ok"}']);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.deepEqual(calls, [{ query: 'signals' }]);
  assert.equal(r.steps[0].action.tool, 'mcp__angular-cli__search_documentation');
  assert.equal(r.steps[0].observation.ok, true);
});

test('runAgent sugiere nombres válidos parecidos cuando el modelo trunca el nombre de la tool', async () => {
  const tools = { 'mcp__angular-cli__list_projects': { summary: 'x', run: async () => ({}) }, 'mcp__angular-cli__generate': { summary: 'y', run: async () => ({}) } };
  const chatImpl = scripted(['{"action":{"tool":"mcp__angular-cli","args":{}}}', '{"done":true,"summary":"ok"}']);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.match(r.steps[0].observation.error, /unknown tool/);
  assert.ok(r.steps[0].observation.available.includes('mcp__angular-cli__list_projects'));
  assert.ok(r.steps[0].observation.available.includes('mcp__angular-cli__generate'));
});

test('runAgent se detiene entre pasos cuando shouldStop devuelve true (interrupción)', async () => {
  let calls = 0;
  let stop = false;
  const tools = { ping: { summary: 'p', run: async () => { calls++; return { ok: true }; } } };
  const chatImpl = scripted(['{"action":{"tool":"ping","args":{}}}', '{"action":{"tool":"ping","args":{"n":2}}}', '{"done":true,"summary":"x"}']);
  const r = await runAgent({ chatImpl, tools, renderPrompt, shouldStop: () => stop, onStep: () => { stop = true; } });
  assert.equal(r.done, false);
  assert.equal(r.interrupted, true);
  assert.match(r.error, /interrumpido/);
  assert.equal(calls, 1);   // el primer paso corrió; el segundo ya no
});

test('runAgent NO ejecuta la acción propuesta si el usuario canceló mientras el modelo generaba', async () => {
  let calls = 0;
  let stop = false;
  const tools = { ping: { summary: 'p', run: async () => { calls++; return { ok: true }; } } };
  // El modelo devuelve una acción, pero el usuario canceló DURANTE la generación (stop se activa dentro del chatImpl).
  const chatImpl = async () => { stop = true; return '{"action":{"tool":"ping","args":{}}}'; };
  const r = await runAgent({ chatImpl, tools, renderPrompt, shouldStop: () => stop });
  assert.equal(r.interrupted, true);
  assert.equal(calls, 0);   // la acción propuesta nunca se ejecutó
});

test('runAgent convierte una excepción del executor en observación de error', async () => {
  const tools = { boom: { summary: 'x', run: async () => { throw new Error('disco lleno'); } } };
  const chatImpl = scripted(['{"action":{"tool":"boom","args":{}}}', '{"done":true,"summary":"ok"}']);
  const r = await runAgent({ chatImpl, tools, renderPrompt });
  assert.match(r.steps[0].observation.error, /disco lleno/);
});

test('runAgent reintenta un turno malformado sin gastar un paso del presupuesto', async () => {
  let seenRetry = false;
  const chatImpl = async ({ user }) => {
    if (user.includes('was not valid')) { seenRetry = true; return '{"done":true,"summary":"recuperado"}'; }
    return 'esto no es json';
  };
  const r = await runAgent({ chatImpl, tools: {}, renderPrompt, maxSteps: 3, maxRetries: 2 });
  assert.equal(seenRetry, true);
  assert.equal(r.done, true);
  assert.equal(r.summary, 'recuperado');
});

test('runAgent falla limpio si agota los reintentos con respuestas inválidas', async () => {
  const r = await runAgent({ chatImpl: async () => 'basura', tools: {}, renderPrompt, maxSteps: 2, maxRetries: 1 });
  assert.equal(r.done, false);
  assert.match(r.error, /Sin turno válido tras 2 intentos/);
});

test('runAgent se recupera si chatImpl falla una vez (red) y luego responde', async () => {
  let n = 0;
  const chatImpl = async () => {
    n++;
    if (n === 1) throw new Error('ECONNREFUSED');
    return '{"done":true,"summary":"recuperado tras reintento"}';
  };
  const r = await runAgent({ chatImpl, tools: {}, renderPrompt, maxSteps: 2, maxRetries: 2 });
  assert.equal(r.done, true);
  assert.equal(r.summary, 'recuperado tras reintento');
});

test('runAgent reporta el error del modelo si chatImpl siempre falla', async () => {
  const r = await runAgent({ chatImpl: async () => { throw new Error('servidor caído'); }, tools: {}, renderPrompt, maxSteps: 2, maxRetries: 1 });
  assert.equal(r.done, false);
  assert.match(r.error, /error al llamar al modelo: servidor caído/);
});

test('runAgent se detiene al agotar los pasos sin done', async () => {
  const tools = { ping: { summary: 'p', run: async () => ({ ok: true }) } };
  const chatImpl = async () => '{"action":{"tool":"ping","args":{}}}'; // nunca dice done
  const r = await runAgent({ chatImpl, tools, renderPrompt, maxSteps: 3 });
  assert.equal(r.done, false);
  assert.equal(r.steps.length, 3);
  assert.match(r.error, /agotaron los 3 pasos/);
});

test('runAgent emite cada paso por onStep', async () => {
  const seen = [];
  const tools = { ping: { summary: 'p', run: async () => ({ ok: true }) } };
  const chatImpl = scripted(['{"action":{"tool":"ping","args":{}}}', '{"done":true,"summary":"ok"}']);
  await runAgent({ chatImpl, tools, renderPrompt, onStep: (r) => seen.push(r.action.tool) });
  assert.deepEqual(seen, ['ping']);
});

test('namespace alucinado con punto (repo_browser.list) se resuelve a la tool real por el último segmento', async () => {
  const listed = [];
  const tools = { list: { summary: 'lista', run: async (a) => { listed.push(a.path); return { entries: [] }; } } };
  const turns = [
    '{"thought":"explorar","action":{"tool":"repo_browser.list","args":{"path":"src/app"}}}',
    '{"done":true,"summary":"ok"}'
  ];
  let i = 0;
  const r = await runAgent({ chatImpl: async () => turns[Math.min(i++, turns.length - 1)], tools, renderPrompt });
  assert.equal(r.done, true);
  assert.deepEqual(listed, ['src/app']);                       // se ejecutó list, no un error de tool desconocida
  assert.equal(r.steps[0].action.tool, 'list');                // el registro lleva el nombre REAL resuelto
});

test('namespace con punto cuyo segmento final NO existe sigue siendo tool desconocida', async () => {
  const turns = [
    '{"action":{"tool":"container.exec","args":{"cmd":"ls"}}}',
    '{"done":true,"summary":"ok"}'
  ];
  let i = 0;
  const r = await runAgent({ chatImpl: async () => turns[Math.min(i++, turns.length - 1)], tools: { read: { summary: '', run: async () => ({}) } }, renderPrompt });
  assert.match(r.steps[0].observation.error, /unknown tool: container\.exec/);
});

test('tras 3 "repeated" seguidos con mutación previa exitosa el paso se cierra como done', async () => {
  const tools = { write: { summary: 'escribe', run: async () => ({ path: 'a.ts', ok: true }) } };
  const w = '{"action":{"tool":"write","args":{"path":"a.ts","content":"x"}}}';
  let i = 0;
  const turns = [w, w, w, w];   // escribe una vez, luego repite idéntico (3 repeated) — jamás emite done
  const r = await runAgent({ chatImpl: async () => turns[Math.min(i++, turns.length - 1)], tools, renderPrompt });
  assert.equal(r.done, true);
  assert.match(r.summary, /ya estaba aplicado/);
  assert.equal(r.steps.filter((s) => s.observation?.repeated).length, 3);
});

test('tras 3 "repeated" seguidos SIN mutación el turno falla con error claro', async () => {
  const tools = { read: { summary: 'lee', run: async () => ({ path: 'a.ts', content: 'x' }) } };
  const rTurn = '{"action":{"tool":"read","args":{"path":"a.ts"}}}';
  let i = 0;
  const turns = [rTurn, rTurn, rTurn, rTurn];
  const r = await runAgent({ chatImpl: async () => turns[Math.min(i++, turns.length - 1)], tools, renderPrompt });
  assert.equal(r.done, false);
  assert.match(r.error, /sin producir cambios/);
});

test('un error al llamar al modelo emite un evento visible por onStep y NO contamina los steps', async () => {
  let calls = 0;
  const events = [];
  const chatImpl = async () => {
    calls++;
    if (calls <= 2) throw new Error('Timeout al conectar con http://localhost:11434/api/chat');
    return '{"done":true,"summary":"listo"}';
  };
  const r = await runAgent({ chatImpl, tools: {}, renderPrompt: () => ({ system: 's', user: 'u' }), onStep: (s) => events.push(s) });
  assert.equal(r.done, true);
  // 2 fallos → 2 avisos de reintento con contador, por el MISMO canal que pinta los pasos
  const retries = events.filter((e) => e.action?.tool === 'modelo');
  assert.equal(retries.length, 2);
  assert.match(retries[0].observation.error, /Timeout.*reintento 1\/3/);
  assert.match(retries[1].observation.error, /reintento 2\/3/);
  // ...pero los steps del resultado quedan limpios: el modelo nunca ve estos eventos
  assert.equal(r.steps.length, 0);
});
