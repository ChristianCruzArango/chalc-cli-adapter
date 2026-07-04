import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, assembleWithinBudget } from '../cli/engine/budgeter.mjs';
import { toolIndex, buildSystem, formatHistory, createRenderPrompt } from '../cli/engine/harness.mjs';

test('estimateTokens es una cota barata (~chars/4)', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('a'.repeat(400)), 100);
});

test('assembleWithinBudget: requeridas siempre; opcionales mientras quepan; conserva orden', () => {
  const sections = [
    { key: 'req', text: 'R'.repeat(40), required: true },   // 10 tokens, siempre
    { key: 'a', text: 'A'.repeat(40) },                     // 10 tokens
    { key: 'b', text: 'B'.repeat(40) },                     // 10 tokens
    { key: 'c', text: 'C'.repeat(40) }                      // 10 tokens
  ];
  const r = assembleWithinBudget(sections, 25); // caben req(10)+a(10)=20; b/c no
  assert.deepEqual(r.included, ['req', 'a']);
  assert.deepEqual(r.dropped, ['b', 'c']);
  assert.ok(r.text.startsWith('R'.repeat(40)));   // orden original
});

test('assembleWithinBudget: la requerida entra aunque exceda el presupuesto', () => {
  const r = assembleWithinBudget([{ key: 'big', text: 'X'.repeat(4000), required: true }], 10);
  assert.deepEqual(r.included, ['big']);
});

test('toolIndex es compacto: nombre + una línea, sin esquemas', () => {
  const idx = toolIndex({ read: { summary: 'lee un archivo' }, bash: { summary: 'corre un comando' } });
  assert.equal(idx, '- read: lee un archivo\n- bash: corre un comando');
});

test('buildSystem (es) incluye protocolo + tools y mete el contexto de proyecto que cabe', () => {
  const tools = { read: { summary: 'lee' } };
  const sys = buildSystem({ tools, projectSections: [{ key: 'con', text: 'CONSTITUCION', required: true }], budgetTokens: Infinity, language: 'es' });
  assert.match(sys, /ONE SINGLE JSON object/);
  assert.match(sys, /## Tools/);
  assert.match(sys, /- read: lee/);
  assert.match(sys, /CONSTITUCION/);
});

test('buildSystem (en) traduce protocolo y encabezados', () => {
  const sys = buildSystem({ tools: { read: { summary: 'reads' } }, budgetTokens: Infinity, language: 'en' });
  assert.match(sys, /ONE SINGLE JSON object/);
  assert.match(sys, /## Tools/);
  assert.doesNotMatch(sys, /Herramientas/);
});

test('buildSystem descarta contexto de proyecto opcional cuando no cabe', () => {
  const tools = { read: { summary: 'lee' } };
  // presupuesto minúsculo: el core (protocolo+tools) ya lo consume, no cabe la sección opcional
  const sys = buildSystem({ tools, projectSections: [{ key: 'skill', text: 'S'.repeat(4000) }], budgetTokens: 30, language: 'es' });
  assert.doesNotMatch(sys, /SSSS/);
});

test('formatHistory (es) limita los pasos visibles y muestra acción + obs', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ step: i + 1, thought: 't', action: { tool: 'read' }, observation: { ok: true } }));
  const txt = formatHistory(history, { max: 3, language: 'es' });
  assert.match(txt, /Step 18/);
  assert.doesNotMatch(txt, /Step 17/);
  assert.match(txt, /"tool":"read"/);
});

test('formatHistory (en) usa Step y sin-pasos en inglés', () => {
  assert.match(formatHistory([], { language: 'en' }), /no steps yet/);
  assert.match(formatHistory([{ step: 1, action: {}, observation: {} }], { language: 'en' }), /Step 1/);
});

test('createRenderPrompt (es) exige tarea y produce {system,user} con presupuesto de pasos', () => {
  assert.throws(() => createRenderPrompt({ task: '' }), /requiere una tarea/);
  const render = createRenderPrompt({ task: 'Agrega un endpoint', tools: { read: { summary: 'lee' } }, language: 'es' });
  const mid = render({ history: [], stepsLeft: 5, retry: '' });
  assert.match(mid.system, /- read: lee/);
  assert.match(mid.user, /## Task/);
  assert.match(mid.user, /Agrega un endpoint/);
  assert.match(mid.user, /5 steps left/);
});

test('createRenderPrompt (en): último paso y etiquetas en inglés', () => {
  const render = createRenderPrompt({ task: 'Add endpoint', language: 'en' });
  assert.match(render({ stepsLeft: 0 }).user, /LAST STEP/);
  assert.match(render({ stepsLeft: 5 }).user, /## Task/);
  assert.match(render({ stepsLeft: 5 }).user, /5 steps left/);
});

test('createRenderPrompt: último paso exige done, y el reintento se anexa', () => {
  const render = createRenderPrompt({ task: 'X', language: 'es' });
  assert.match(render({ stepsLeft: 0 }).user, /LAST STEP/);
  assert.match(render({ stepsLeft: 3, retry: 'CORRIGE ESTO' }).user, /CORRIGE ESTO/);
});

test('createRenderPrompt reutiliza el mismo system en cada turno (cacheable)', () => {
  const render = createRenderPrompt({ task: 'X', tools: { read: { summary: 'lee' } }, language: 'es' });
  assert.equal(render({ stepsLeft: 5 }).system, render({ stepsLeft: 1 }).system);
});

// ——— Portón de verificación (engine/verify.mjs) ———
test('verifyCommand mapea el stack al chequeo de su toolchain (y null si no hay)', async () => {
  const { verifyCommand } = await import('../cli/engine/verify.mjs');
  assert.match(verifyCommand(['angular']), /ng build/);
  assert.match(verifyCommand(['dotnet']), /dotnet build/);
  assert.equal(verifyCommand(['cobol']), null);
  assert.equal(verifyCommand([]), null);
});

test('runVerify sin comando para el stack se omite sin bloquear (skipped + ok)', async () => {
  const { runVerify } = await import('../cli/engine/verify.mjs');
  const r = await runVerify({ projectPath: '.', stacks: ['desconocido'] });
  assert.deepEqual(r, { skipped: true, ok: true });
});
