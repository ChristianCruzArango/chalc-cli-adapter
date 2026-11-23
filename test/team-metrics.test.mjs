// Spec 037 (evals pasivos), T2 y T3 — medir al equipo con lo que ya quedó registrado (R2–R6): por nivel de
// modelo y versión de instrucciones, sin gastar un token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { team, writeFiles } from './helpers/teamrepo.mjs';
import { appendEvent } from '../catalog/team/lib/ledger.mjs';
import { metricsOf } from '../catalog/team/lib/metrics.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const T = (m) => new Date(Date.parse('2026-11-22T10:00:00.000Z') + m * 60000).toISOString();
const A = 'specs/027-checkout';
const B = 'specs/028-recibos';
const C = 'specs/101-rutas';
let clock = 0;
const at = (event) => ({ at: T(clock += 1), ...event });
const dispatch = (spec, role, tier, instructions) => ({ type: 'dispatched', spec, role, launcher: 'nativo', tier, instructions });
const reviewed = (spec, role, ok) => ({ type: 'reviewed', spec, role, ok, findings: ok ? 0 : 1, summary: ok ? 'OK' : 'falta' });
const start = (spec, tier = 'medio') => ({ type: 'started', spec, worktree: 'w', branch: 'b', launcher: 'nativo', tier });
// A: aprobada a la primera con (medio, v1). B: rechazada por el revisor, rehecha con las instrucciones v2 y aprobada;
// luego rompe al integrarse. C (otra feature): tres rechazos, relanzada en alto, y escalada.
function history() {
  clock = 0;
  const rejectC = () => [{ type: 'delivered', spec: C, head: 'c' }, dispatch(C, 'revisor', 'alto', 'r1'), reviewed(C, 'revisor', false)];
  return [
    { type: 'feature_opened', feature: 'pagos', agent: 'c' }, { type: 'spec_added', feature: 'pagos', spec: A }, { type: 'spec_added', feature: 'pagos', spec: B },
    { type: 'feature_opened', feature: 'envios', agent: 'c' }, { type: 'spec_added', feature: 'envios', spec: C },
    start(A), dispatch(A, 'desarrollador', 'medio', 'v1'), { type: 'delivered', spec: A, head: 'a' },
    dispatch(A, 'seguridad', 'alto', 's1'), dispatch(A, 'revisor', 'alto', 'r1'), reviewed(A, 'seguridad', true), reviewed(A, 'revisor', true),
    { type: 'integrated', spec: A, head: 'i1' },
    start(B), dispatch(B, 'desarrollador', 'medio', 'v1'), { type: 'delivered', spec: B, head: 'b1' },
    dispatch(B, 'seguridad', 'alto', 's1'), dispatch(B, 'revisor', 'alto', 'r1'), reviewed(B, 'revisor', false),
    { type: 'rework', spec: B }, dispatch(B, 'desarrollador', 'medio', 'v2'), { type: 'delivered', spec: B, head: 'b2' },
    dispatch(B, 'seguridad', 'alto', 's1'), dispatch(B, 'revisor', 'alto', 'r2'), reviewed(B, 'seguridad', true), reviewed(B, 'revisor', true),
    reviewed(B, 'integracion', false),
    start(C), dispatch(C, 'desarrollador', 'medio', 'v2'), ...rejectC(), { type: 'rework', spec: C }, ...rejectC(), { type: 'rework', spec: C }, ...rejectC(),
    { type: 'relaunched', spec: C, tier: 'alto' }, dispatch(C, 'desarrollador', 'alto', 'v2'), ...rejectC(),
    { type: 'escalated', spec: C, reason: 'x' }, { type: 'blocked', spec: A, reason: 'conflicto al integrar en x', by: 'integracion' }, { type: 'blocked', spec: B, reason: 'falta una clave' }
  ].map(at);
}

test('R2: por configuración del desarrollador: entregas, aprobadas a la primera, rechazadas, relanzamientos y escalados', () => {
  const { developers } = metricsOf(history());
  assert.deepEqual(developers, [
    { tier: 'alto', instructions: 'v2', deliveries: 1, approved: 0, firstPass: 0, rejected: 1, relaunched: 0, escalated: 1 },
    { tier: 'medio', instructions: 'v1', deliveries: 2, approved: 1, firstPass: 1, rejected: 1, relaunched: 0, escalated: 0 },
    { tier: 'medio', instructions: 'v2', deliveries: 4, approved: 1, firstPass: 0, rejected: 3, relaunched: 1, escalated: 0 }
  ]);
});

test('R3: por rol de revisión y versión: veredictos y rechazos; y la integración aparte', () => {
  const { reviewers, integration } = metricsOf(history());
  assert.deepEqual(reviewers, [
    { role: 'revisor', instructions: 'r1', verdicts: 6, rejections: 5 },
    { role: 'revisor', instructions: 'r2', verdicts: 1, rejections: 0 },
    { role: 'seguridad', instructions: 's1', verdicts: 2, rejections: 0 }
  ]);
  assert.deepEqual(integration, { merged: 1, broke: 1, conflicts: 1 });
});

test('R4: el tiempo medio de empezar a integrar, y cuántas specs entran en la cuenta', () => {
  const out = metricsOf(history());
  assert.deepEqual([out.specs, out.integrated], [3, 1]);
  // A empezó en el evento 6 y se integró en el 13: 7 minutos.
  assert.equal(out.leadTimeMs, 7 * 60000);
  assert.equal(metricsOf([]).leadTimeMs, null);
});

test('R5: limitado a una feature, solo cuentan sus specs', () => {
  const out = metricsOf(history(), { feature: 'envios' });
  assert.deepEqual(out.developers.map((d) => [d.tier, d.deliveries]), [['alto', 1], ['medio', 3]]);
  assert.deepEqual([out.specs, out.integration], [1, { merged: 0, broke: 0, conflicts: 0 }]);
  assert.deepEqual(metricsOf(history(), { feature: 'nadie' }).developers, []);
});

test('R6: sin despacho registrado la versión es «?», y una aprobación exige el OK de todos los que firmaron', () => {
  clock = 0;
  const events = [{ type: 'feature_opened', feature: 'f', agent: 'c' }, { type: 'spec_added', feature: 'f', spec: A }, start(A, 'economico'),
    { type: 'delivered', spec: A, head: 'a' }, reviewed(A, 'seguridad', true), reviewed(A, 'revisor', false)].map(at);
  const out = metricsOf(events);
  assert.deepEqual(out.developers, [{ tier: 'economico', instructions: '?', deliveries: 1, approved: 0, firstPass: 0, rejected: 1, relaunched: 0, escalated: 0 }]);
  assert.deepEqual(out.reviewers.map((r) => [r.role, r.instructions, r.verdicts]), [['revisor', '?', 1], ['seguridad', '?', 1]]);
});

// ── T3: el comando ───────────────────────────────────────────────────────────────────────────────

async function recorded(t, language = 'es') {
  const root = join(await tempDir(t, 'chalc-037-evals-'), 'repo');
  await writeFiles(root, { '.chalc/gate.json': JSON.stringify({ language }) });
  for (const { at: _at, ...event } of history()) await appendEvent(root, event);
  return root;
}

for (const lang of ['es', 'en']) {
  test(`R2, R3 (${lang}): \`evals\` muestra las cifras en el idioma del proyecto`, async (t) => {
    const out = await team(await recorded(t, lang), 'evals');
    assert.equal(out.code, 0, out.text);
    const e = TEXT[lang].evals;
    for (const piece of [e.title, e.developers, e.reviewers, e.integration, e.leadTime, 'medio', 'v1', 'revisor', 'r1', e.caveat]) assert.ok(out.text.includes(piece), piece);
  });
}

test('R5: `evals --json` entrega los datos, y `--feature` los limita', async (t) => {
  const root = await recorded(t);
  const all = JSON.parse((await team(root, 'evals', '--json')).text);
  assert.deepEqual(Object.keys(all).sort(), ['developers', 'integrated', 'integration', 'leadTimeMs', 'reviewers', 'specs']);
  assert.equal(all.specs, 3);
  assert.equal(JSON.parse((await team(root, 'evals', '--json', '--feature', 'envios')).text).specs, 1);
});

test('R6: sin nada registrado lo dice, y no falla', async (t) => {
  const root = join(await tempDir(t, 'chalc-037-evals-'), 'repo');
  await writeFiles(root, { '.chalc/gate.json': JSON.stringify({ language: 'es' }) });
  const out = await team(root, 'evals');
  assert.deepEqual([out.code, out.text.includes(TEXT.es.evals.empty)], [0, true]);
});
