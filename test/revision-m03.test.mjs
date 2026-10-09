// M-03 (spec 016, R30) — los mensajes de error que ve el usuario pasan por t(): antes se lanzaban como
// strings fijos en español y bin/chalc.mjs los imprimía tal cual, también a quien usa el CLI en inglés.
// Un `throw new Error('…')` con literal solo se admite con su motivo registrado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICT, lang as activeLang } from '../lib/i18n.mjs';
import { assertPublicHost, assertPublicUrl } from '../lib/net.mjs';
import { chat } from '../lib/ai.mjs';
import { scaffoldSteps } from '../lib/init.mjs';
import { parseAgentMessage } from '../lib/qaagent.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LITERAL_THROW = /throw new Error\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*[,)]/g;

const CONTRACT = 'error de programación (contrato de una API interna): no aparece en uso normal';
const MODEL = 'observación para el MODELO, en inglés como el resto de observaciones de las tools';
const TECHNICAL = 'mensaje técnico sin prosa (servicio + código HTTP + cuerpo)';
const INTERNAL = 'control de flujo interno: se captura en el acto y su texto nunca se muestra';
const ALLOWED = {
  'cli/sessionturns.mjs::plan requiere una tarea.': CONTRACT,
  'cli/sessionturns.mjs::review requiere la tarea revisada.': CONTRACT,
  'cli/sessionturns.mjs::ask requiere una tarea.': CONTRACT,
  'cli/tools/shell.mjs::createShellTool requiere root.': CONTRACT,
  'cli/tools/registry.mjs::createTools requiere root (raíz del proyecto).': CONTRACT,
  'cli/tools/fs.mjs::createFsTools requiere root.': CONTRACT,
  'cli/mcp/jsonrpc.mjs::createJsonRpc requiere send(message).': CONTRACT,
  'cli/engine/loop.mjs::runAgent requiere chatImpl.': CONTRACT,
  'cli/engine/loop.mjs::runAgent requiere renderPrompt.': CONTRACT,
  'cli/session.mjs::runTask requiere una tarea.': CONTRACT,
  'cli/engine/plan.mjs::runPlanner requiere una tarea.': CONTRACT,
  'cli/engine/harness.mjs::createRenderPrompt requiere una tarea.': CONTRACT,
  'lib/qaagent.mjs::runQaAgent requiere un executor.': CONTRACT,
  'lib/promptkit.mjs::Falta variable de prompt: ${key}': CONTRACT,
  'lib/promptkit.mjs::Nombre de sección inválido: ${name}': CONTRACT,
  'lib/debate/engine.mjs::rounds must be an integer >= 1 (got ${rounds})': CONTRACT,
  'cli/tools/fsconfine.mjs::path outside the project: ${p}': MODEL,
  'cli/tools/fsconfine.mjs::path outside the project (symlink): ${p}': MODEL,
  'cli/tools/fsconfine.mjs::writing inside .git/ is not allowed: ${p}': MODEL,
  'cli/tools/shellpolicy.mjs::unterminated quote': MODEL,
  'cli/engine/model.mjs::Ollama ${res.status}: ${await readLimitedText(res)}': TECHNICAL,
  'lib/ai.mjs::Anthropic ${res.status}: ${await readLimitedText(res)}': TECHNICAL,
  'lib/ai.mjs::API ${res.status}: ${await readLimitedText(res)}': TECHNICAL,
  'lib/sources.mjs::URL ${res.status}: ${current}': TECHNICAL,
  'lib/sources.mjs::Azure DevOps ${res.status}: ${(await readLimitedText(res)).slice(0, 300)}': TECHNICAL,
  'lib/sources.mjs::Jira ${res.status}: ${(await readLimitedText(res)).slice(0, 300)}': TECHNICAL,
  'lib/dashboard.mjs::lado sin advisor emitido': INTERNAL
};

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? (n === 'i18n' ? [] : walk(p)) : p.endsWith('.mjs') ? [p] : [];
});

test('R30: every literal Error message in bin/, cli/, lib/ and targets/ is registered with its reason', () => {
  const found = new Set();
  for (const file of ['bin', 'cli', 'lib', 'targets'].flatMap((r) => walk(join(ROOT, r)))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    for (const m of readFileSync(file, 'utf8').matchAll(LITERAL_THROW)) found.add(`${rel}::${m[2]}`);
  }
  assert.deepEqual([...found].sort(), Object.keys(ALLOWED).sort());
});

test('R30: the user-facing errors now have es/en texts', () => {
  for (const key of ['netNoHost', 'netUnresolvable', 'netNoAddresses', 'netTooManyRedirects', 'netTimeout', 'aiUnknownProvider', 'initUnknownStack', 'agentNotJson']) {
    assert.ok(DICT.es[key], `es.${key}`);
    assert.ok(DICT.en[key], `en.${key}`);
    const render = (v) => (typeof v === 'function' ? v('X') : v);
    assert.notEqual(render(DICT.es[key]), render(DICT.en[key]), key);
  }
});

test('R30: the converted errors are raised with the translated text', async () => {
  const lang = DICT[activeLang];   // el idioma que t() aplica de verdad (precedencia completa)
  const pick = (k, arg) => (typeof lang[k] === 'function' ? lang[k](arg) : lang[k]);
  assert.throws(() => assertPublicHost(''), (e) => e.message === pick('netNoHost'));
  await assert.rejects(() => chat({ provider: 'no-existe' }, { system: 's', user: 'u' }), (e) => e.message === pick('aiUnknownProvider', 'no-existe'));
  assert.throws(() => scaffoldSteps('no-existe'), (e) => e.message === pick('initUnknownStack', 'no-existe'));
  assert.throws(() => parseAgentMessage('[1,2]'), (e) => e.message === pick('agentNotJson'));
  await assert.rejects(() => assertPublicUrl('https://chalc-no-such-host.invalid/x'), (e) => e.message === pick('netUnresolvable', 'chalc-no-such-host.invalid'));
});
