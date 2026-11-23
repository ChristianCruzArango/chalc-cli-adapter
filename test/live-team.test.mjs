// Spec 032 (estado de equipo), T7 — el tablero en vivo muestra al equipo (R13): cada feature con su líder y cada
// spec con en qué va. Sin equipo registrado, la sección no aparece. Todo se pinta como texto, nunca como HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { teamOf } from '../catalog/live/lib/team.mjs';
import { buildState } from '../catalog/live/server.mjs';
import { LABELS, pageHtml } from '../catalog/live/lib/page.mjs';
import { appendEvent } from '../catalog/team/lib/ledger.mjs';
import { reduce } from '../catalog/team/lib/reduce.mjs';
import { ACTIONS } from '../catalog/next/lib/actions.mjs';

const T = (m) => new Date(Date.parse('2026-11-22T10:00:00.000Z') + m * 60000).toISOString();
const S = 'specs/027-checkout';
const EVENTS = [
  { at: T(0), type: 'feature_opened', feature: 'pagos', agent: 'claude' },
  { at: T(1), type: 'spec_added', feature: 'pagos', spec: S },
  { at: T(2), type: 'started', spec: S, worktree: 'w', branch: 'b', launcher: 'codex', tier: 'medio' },
  { at: T(3), type: 'signal', spec: S, phase: 'GREEN', task: '3 de 7' },
  { at: T(4), type: 'gate', spec: S, verdict: 'fail', stage: 'mutation', score: 71 },
  { at: T(5), type: 'needs_human', feature: 'pagos', reason: 'aprobar cierre', command: 'node .chalc/gate.mjs --approve-feature' }
];
const status = (events = EVENTS, now = T(10)) => reduce(events, { now: Date.parse(now), stallMs: 20 * 60000, maxAttempts: 3 });

test('R13: sin features registradas no hay sección de equipo', () => {
  assert.equal(teamOf(status([])), null);
  assert.equal(teamOf(null), null);
  assert.equal(teamOf({}), null);
});

test('R13: cada feature con su líder y cada spec con su estado, desarrollador, fase, tarea, intento y portón', () => {
  assert.deepEqual(teamOf(status()), {
    waiting: [{ feature: 'pagos', reason: 'aprobar cierre', command: 'node .chalc/gate.mjs --approve-feature' }],
    features: [{
      feature: 'pagos', agent: 'claude', action: '', closed: false,
      specs: [{ spec: S, state: 'in_dev', developer: 'codex · medio', phase: 'GREEN', task: '3 de 7', attempt: '1/3', gate: 'fail mutation 71%', note: '', stalled: false }]
    }]
  });
});

test('R13: la nota de una spec es su bloqueo o, si fue rechazada, el último hallazgo; y el atasco se marca', () => {
  const blocked = teamOf(status([...EVENTS, { at: T(6), type: 'blocked', spec: S, reason: 'falta la clave' }])).features[0].specs[0];
  assert.deepEqual([blocked.state, blocked.note], ['blocked', 'falta la clave']);
  const rejected = teamOf(status([...EVENTS, { at: T(6), type: 'delivered', spec: S, head: 'a' }, { at: T(7), type: 'reviewed', spec: S, role: 'revisor', ok: false, findings: 1, summary: 'R2 sin probar' }])).features[0].specs[0];
  assert.equal(rejected.note, 'revisor: R2 sin probar');
  assert.equal(teamOf(status(EVENTS, T(90))).features[0].specs[0].stalled, true);
});

test('R13: el estado del tablero trae al equipo del repo, o null si no hay registro', async (t) => {
  const root = await tempDir(t, 'chalc-032-live-');
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ language: 'es', spec: { dir: 'specs' } }));
  assert.equal((await buildState(root)).team, null);
  for (const event of EVENTS.slice(0, 3)) await appendEvent(root, event);
  const view = await buildState(root);
  assert.deepEqual(view.team.features.map((f) => [f.feature, f.specs.map((s) => s.state)]), [['pagos', ['in_dev']]]);
});

for (const lang of ['es', 'en']) {
  test(`R13 (${lang}): la página tiene la sección de equipo, con sus textos y cada estado traducido`, () => {
    const html = pageHtml(lang);
    assert.ok(html.includes('<section id="team"'));
    assert.ok(html.includes('function team('));
    const labels = LABELS[lang];
    assert.ok(labels.sections.team);
    for (const state of ['draft', 'approved', 'scheduled', 'in_dev', 'delivered', 'rejected', 'reviewed_ok', 'integrated', 'blocked', 'escalated']) assert.ok(labels.teamStates[state], state);
    for (const key of ['waiting', 'lead', 'stalled', 'closed']) assert.ok(labels.team[key], key);
  });

  test(`(${lang}) cada acción del advisor tiene su etiqueta en el tablero`, () => {
    for (const action of ACTIONS) assert.ok(LABELS[lang].actions[action], action);
  });
}

test('el script del tablero pinta al equipo como texto: nada de innerHTML', () => {
  const html = pageHtml('es');
  const script = html.slice(html.indexOf('function team('));
  assert.equal(script.slice(0, script.indexOf('\nfunction ', 10)).includes('innerHTML'), false);
});
