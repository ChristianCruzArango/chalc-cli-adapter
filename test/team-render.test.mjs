// Spec 032 (estado de equipo), T4 — el estado como tabla y el informe (R8, R10, R11). Los dos salen del registro:
// el informe no lo redacta un modelo, y dice también lo que NO se verificó.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce } from '../catalog/team/lib/reduce.mjs';
import { renderStatus } from '../catalog/team/lib/render.mjs';
import { renderReport } from '../catalog/team/lib/report.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const T = (m) => new Date(Date.parse('2026-11-22T10:00:00.000Z') + m * 60000).toISOString();
const A = 'specs/027-checkout';
const B = 'specs/028-recibos';
const OPTS = { now: Date.parse(T(90)), stallMs: 20 * 60000, maxAttempts: 3 };
const start = (spec, m) => ({ at: T(m), type: 'started', spec, worktree: `../wt/${spec.slice(6)}`, branch: `chalc/${spec.slice(6)}`, launcher: 'codex', tier: 'medio' });
const EVENTS = [
  { at: T(0), type: 'feature_opened', feature: 'pagos', agent: 'claude' },
  { at: T(1), type: 'spec_added', feature: 'pagos', spec: A },
  { at: T(1), type: 'spec_added', feature: 'pagos', spec: B },
  start(A, 5), start(B, 5),
  { at: T(20), type: 'gate', spec: A, verdict: 'fail', stage: 'mutation', score: 71, fast: false },
  { at: T(30), type: 'delivered', spec: A, head: 'a1' },
  { at: T(31), type: 'reviewed', spec: A, role: 'revisor', ok: false, findings: 1, summary: 'el test de R2 no comprueba el total' },
  { at: T(32), type: 'rework', spec: A },
  { at: T(40), type: 'gate', spec: A, verdict: 'pass', stage: '', score: 92, fast: false },
  { at: T(41), type: 'delivered', spec: A, head: 'a2' },
  { at: T(42), type: 'reviewed', spec: A, role: 'revisor', ok: true, findings: 0, summary: 'OK' },
  { at: T(43), type: 'integrated', spec: A, head: 'm1' },
  { at: T(44), type: 'blocked', spec: B, reason: 'falta la clave del API de recibos' },
  { at: T(45), type: 'lead', feature: 'pagos', action: 'integrando' },
  { at: T(46), type: 'needs_human', feature: 'pagos', reason: 'desbloquear recibos', command: 'node .chalc/team.mjs status' }
];
const status = reduce(EVENTS, OPTS);

test('paridad: los textos del equipo tienen las mismas claves en es y en', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(keys(TEXT.es), keys(TEXT.en));
});

for (const lang of ['es', 'en']) {
  test(`R8 (${lang}): la tabla muestra cada feature con su líder y cada spec con en qué va`, () => {
    const table = renderStatus(status, lang);
    for (const piece of ['pagos', 'claude', 'integrando', A, B, 'codex', '2/3', '92', TEXT[lang].state.integrated, TEXT[lang].state.blocked, 'falta la clave del API de recibos']) {
      assert.ok(table.includes(piece), `falta «${piece}»`);
    }
    assert.ok(table.includes('node .chalc/team.mjs status'), 'lo que espera al usuario, con su comando');
  });

  test(`R8 (${lang}): sin nada registrado lo dice, y un posible atasco se marca`, () => {
    assert.ok(renderStatus(reduce([], OPTS), lang).includes(TEXT[lang].empty));
    const stuck = reduce(EVENTS.slice(0, 5), OPTS);
    assert.ok(renderStatus(stuck, lang).includes(TEXT[lang].stalled));
    assert.equal(renderStatus(status, lang).includes(TEXT[lang].stalled), false);
  });

  test(`R10 (${lang}): el informe da, por spec, estado, intentos, cada rechazo con su motivo y el último portón`, () => {
    const report = renderReport(EVENTS, 'pagos', { lang, ...OPTS });
    assert.ok(report.startsWith('# '));
    for (const piece of [A, B, TEXT[lang].state.integrated, 'el test de R2 no comprueba el total', 'revisor', '92', 'falta la clave del API de recibos']) {
      assert.ok(report.includes(piece), `falta «${piece}»`);
    }
    assert.match(report, /2\s*\/\s*3|2 (de|of) 3/);
  });

  test(`R11 (${lang}): el informe lista lo que NO se verificó`, () => {
    const report = renderReport(EVENTS, 'pagos', { lang, ...OPTS });
    const section = report.slice(report.indexOf(TEXT[lang].report.unverified));
    assert.ok(section.includes(B), 'la spec bloqueada no quedó integrada');
    assert.ok(section.includes(TEXT[lang].report.notClosed), 'el cierre no lo aprobó el usuario');
    assert.equal(section.includes(`${A}:`), false, 'la integrada y medida no está en esa lista');
  });

  test(`R11 (${lang}): con todo integrado, medido y cerrado, la sección lo dice en vez de desaparecer`, () => {
    const clean = [...EVENTS.slice(0, 2), start(A, 5), { at: T(40), type: 'gate', spec: A, verdict: 'pass', fast: false },
      { at: T(41), type: 'delivered', spec: A, head: 'a' }, { at: T(42), type: 'reviewed', spec: A, role: 'revisor', ok: true, findings: 0, summary: 'OK' },
      { at: T(43), type: 'integrated', spec: A, head: 'm' }, { at: T(50), type: 'closed', feature: 'pagos' }];
    const report = renderReport(clean, 'pagos', { lang, ...OPTS });
    assert.ok(report.includes(TEXT[lang].report.unverified));
    assert.ok(report.includes(TEXT[lang].report.nothing));
  });

  test(`R11 (${lang}): una spec integrada sin corrida completa del portón que apruebe sí se lista`, () => {
    for (const gate of [null, { verdict: 'pass', fast: true }, { verdict: 'fail', fast: false }]) {
      const events = [...EVENTS.slice(0, 2), start(A, 5), ...(gate ? [{ at: T(40), type: 'gate', spec: A, ...gate }] : []), { at: T(43), type: 'integrated', spec: A, head: 'm' }, { at: T(50), type: 'closed', feature: 'pagos' }];
      const report = renderReport(events, 'pagos', { lang, ...OPTS });
      assert.ok(report.includes(TEXT[lang].report.noFullGate), JSON.stringify(gate));
    }
  });

  test(`R10 (${lang}): una feature que no existe da un informe que lo dice`, () => {
    assert.ok(renderReport(EVENTS, 'otra', { lang, ...OPTS }).includes(TEXT[lang].report.unknownFeature('otra')));
  });
}
