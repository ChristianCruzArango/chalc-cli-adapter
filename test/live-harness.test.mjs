// T25 (spec 020, R22) — el tablero sabe para qué harness está equipado el proyecto, y en qué idioma.
//
// Todo lo que muestra sale de archivos del repo y sirve con cualquier harness, salvo la actividad en vivo y los
// tokens: salen de los hooks de Claude Code. Con Codex, Antigravity, Cursor o Copilot no debe pedir un hook que no les
// aplica: dice cuál es el harness y qué parte no existe para él. Encontrado al equipar un repo para cada target.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readProject } from '../catalog/live/lib/project.mjs';
import { viewOf } from '../catalog/live/lib/view.mjs';
import { buildState } from '../catalog/live/server.mjs';
import { LABELS, pageHtml } from '../catalog/live/lib/page.mjs';

const project = async (chalc, gate) => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-live-harness-'));
  await mkdir(join(root, '.chalc'), { recursive: true });
  if (chalc !== undefined) await writeFile(join(root, '.chalc.json'), typeof chalc === 'string' ? chalc : JSON.stringify(chalc));
  if (gate) await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify(gate));
  return root;
};

test('R22: the project file says the harness and the language chosen when equipping', async () => {
  assert.deepEqual(await readProject(await project({ target: 'antigravity', lang: 'es' })), { target: 'antigravity', lang: 'es' });
  for (const broken of [undefined, '{ roto', '[]', JSON.stringify({ target: 5, lang: null })]) {
    assert.deepEqual(await readProject(await project(broken)), { target: '', lang: '' }, String(broken));
  }
});

test('R22: the view says whether this harness records live activity: only Claude Code does', () => {
  const base = { snapshot: { tasks: {}, gate: {}, review: {}, flow: {}, lang: 'es' }, decision: { action: 'work_task', facts: {} }, reason: '', state: null, tasksText: '', activityText: '' };
  assert.deepEqual(viewOf({ ...base, harness: 'claude' }).harness, { target: 'claude', live: true });
  for (const target of ['codex', 'antigravity', 'cursor', 'copilot']) assert.deepEqual(viewOf({ ...base, harness: target }).harness, { target, live: false }, target);
  assert.deepEqual(viewOf(base).harness, { target: '', live: true });
});

test('R22: the board speaks the language chosen when equipping when gate.json leaves it empty', async () => {
  const root = await project({ target: 'antigravity', lang: 'es' }, { language: '' });
  const v = await buildState(root);
  assert.equal(v.lang, 'es');
  assert.deepEqual(v.harness, { target: 'antigravity', live: false });
  assert.equal((await buildState(await project({ target: 'claude', lang: 'es' }, { language: 'en' }))).lang, 'en', 'gate.json wins when it says one');
  assert.equal((await buildState(await project(undefined, { language: '' }))).lang, 'en', 'nothing says a language: English');
});

test('R22: the page names the harness and says which part does not apply to it, in both languages', () => {
  for (const lang of ['es', 'en']) {
    const html = pageHtml(lang);
    for (const target of ['claude', 'codex', 'antigravity', 'cursor', 'copilot']) assert.ok(LABELS[lang].harness[target], `${lang}: ${target}`);
    assert.match(LABELS[lang].words.noLiveHarness, /\{harness\}/, lang);
    assert.ok(html.includes('v.harness.live'), lang);
  }
});
