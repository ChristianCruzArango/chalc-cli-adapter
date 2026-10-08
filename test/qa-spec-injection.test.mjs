// S-07 — el texto de una HU no puede convertirse en código dentro de los specs Playwright generados.
//
// La auditoría lo reprodujo: `x\',()=>{});console.log("INJECTED");(()=>{//` cerraba el literal y el
// `.agent.spec.mjs` imprimía INJECTED; y truncar DESPUÉS de escapar partía un `\'` (SyntaxError).

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildBrowserTests } from '../lib/qa.mjs';
import { buildAgentReplaySpec } from '../lib/qaagent.mjs';

const PAYLOAD = 'x\\\',()=>{});console.log("INJECTED");(()=>{//';

// Ejecuta el spec generado con `test`/`expect` falsos y devuelve los títulos registrados. Cualquier
// código inyectado correría aquí y quedaría registrado en `ran`.
function evaluate(source) {
  const titles = [];
  const ran = [];
  const body = source.replace(/^import .*$/m, '');
  const fake = (title) => { titles.push(title); };
  fake.fixme = (title) => { titles.push(title); };
  fake.describe = { configure() {} };
  fake.beforeAll = () => {};
  fake.afterAll = () => {};
  vm.runInNewContext(body, { test: fake, expect: () => ({}), console: { log: (m) => ran.push(m) } });
  return { titles, ran };
}

test('buildBrowserTests keeps a hostile requirement as a plain title', () => {
  const context = { id: '001-x', files: { 'spec.md': `- **R1** — ${PAYLOAD}\n` } };
  const out = buildBrowserTests(context, { cases: [{ id: 'R1', path: '/', expected: 'ok' }] });
  const { titles, ran } = evaluate(out);
  assert.deepEqual(ran, []);
  assert.ok(titles.some((t) => t.includes('INJECTED')));
});

test('buildAgentReplaySpec serialises the title and truncates before serialising', () => {
  const steps = [{ action: { type: 'browser', requirement: 'R1', steps: [{ op: 'goto', url: '/' }, { op: 'evil\nconsole.log("INJECTED")' }] }, observation: { ok: true } }];
  for (const text of [PAYLOAD, `${'a'.repeat(94)}'`, `${'a'.repeat(95)}\\`]) {
    const out = buildAgentReplaySpec('001-x', 'http://localhost', steps, { R1: text });
    const { titles, ran } = evaluate(out);
    assert.deepEqual(ran, [], text);
    assert.equal(titles.length, 1);
    assert.ok(titles[0].length <= 100);
  }
});

test('a newline in the spec id cannot escape the header comment', () => {
  const out = buildAgentReplaySpec('id\nconsole.log("INJECTED")', 'http://x', []);
  assert.deepEqual(evaluate(out).ran, []);
});
