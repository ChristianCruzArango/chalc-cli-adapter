// Spec 034 (roles y lanzadores), T3 — despachar un rol (R5–R8): la orden lleva todo lo que el rol necesita
// —sus instrucciones, dónde trabaja, las reglas del proyecto, sus skills, la spec y cómo informa— y dice con qué
// lanzador y nivel corre. chalc no lanza nada: entrega la orden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { gitRepo, specFiles, team, writeFiles } from './helpers/teamrepo.mjs';
import { appendEvent, readLedger, readStatus } from '../catalog/team/lib/ledger.mjs';
import { reduce } from '../catalog/team/lib/reduce.mjs';
import { TEXT } from '../catalog/team/lib/i18n.mjs';

const A = 'specs/027-checkout';
const B = 'specs/028-recibos';
const ROLES = ['desarrollador', 'revisor', 'seguridad', 'lider'];
const gate = (language) => ({ '.chalc/gate.json': JSON.stringify({ language, spec: { dir: 'specs' }, flow: { roles: [
  { id: 'seguridad', order: 5, cadence: 'task', required: true }, { id: 'revisor', order: 10, cadence: 'task', required: true },
  { id: 'endurecedor', order: 20, cadence: 'feature', required: true }] } }) });
const BASE = (language = 'es') => ({
  ...gate(language), ...Object.fromEntries(ROLES.map((role) => [`.chalc/roles/${role}.md`, `rol ${role}\n`])),
  ...specFiles('027-checkout', { touches: ['src/checkout/**'] }), ...specFiles('028-recibos', { touches: ['src/recibos/**'] })
});
// Un repo (sin git) con A en desarrollo en `wt` y B programada.
async function working(t, { language = 'es', teamJson = null, wtFiles = {} } = {}) {
  const base = await tempDir(t, 'chalc-034-dispatch-');
  const root = join(base, 'repo');
  const wt = join(base, 'wt-027');
  await writeFiles(root, { ...BASE(language), ...(teamJson ? { '.chalc/team.json': JSON.stringify(teamJson) } : {}) });
  // El worktree sale de lo commiteado: trae la spec, además de las reglas del proyecto.
  await writeFiles(wt, { ...specFiles('027-checkout', { touches: ['src/checkout/**'] }), 'CLAUDE.md': 'reglas', 'AGENTS.md': 'reglas', 'src/checkout/AGENTS.md': 'reglas', ...wtFiles });
  for (const event of [
    { type: 'feature_opened', feature: 'pagos', agent: 'claude' }, { type: 'spec_added', feature: 'pagos', spec: A }, { type: 'spec_added', feature: 'pagos', spec: B },
    { type: 'scheduled', spec: A, wave: 1 }, { type: 'scheduled', spec: B, wave: 1 },
    { type: 'started', spec: A, worktree: wt, branch: 'chalc/027-checkout', launcher: 'nativo', tier: 'medio', base: 'b0' }
  ]) await appendEvent(root, event);
  return { root, wt, run: (...args) => team(root, ...args, '--root', root) };
}
const orderFile = (root, role, name = '027-checkout') => join(root, '.chalc', 'team', 'orders', `${name}.${role}.md`);
const last = async (root) => (await readLedger(root)).at(-1);

test('R5: la orden del desarrollador lleva sus instrucciones, su carpeta, las reglas del proyecto, sus skills, la spec y cómo informa', async (t) => {
  const { root, wt, run } = await working(t, { teamJson: { roles: { desarrollador: { skills: ['clean-code', 'solid-principles'] } } } });
  const out = await run('dispatch', '--spec', A, '--role', 'desarrollador');
  assert.equal(out.code, 0, out.text);
  const order = await readFile(orderFile(root, 'desarrollador'), 'utf8');
  for (const piece of ['.chalc/roles/desarrollador.md', wt, 'medio', 'nativo', '`CLAUDE.md`', '`AGENTS.md`', '`src/checkout/AGENTS.md`', '`clean-code`', '`solid-principles`',
    `${A}/spec.md`, `${A}/plan.md`, `${A}/tasks.md`, `node .chalc/team.mjs deliver --spec ${A}`, `node .chalc/team.mjs block --spec ${A}`, '1/3']) {
    assert.ok(order.includes(piece), `falta «${piece}»`);
  }
  for (const absent of ['.cursor/rules', 'copilot-instructions']) assert.equal(order.includes(absent), false, absent);
  const event = await last(root);
  assert.deepEqual([event.type, event.spec, event.role, event.launcher, event.tier], ['dispatched', A, 'desarrollador', 'nativo', 'medio']);
  assert.ok(out.text.includes(orderFile(root, 'desarrollador')) && out.text.includes('nativo') && out.text.includes('medio'));
});

test('R5: las reglas de otros asistentes también cuentan cuando existen; las que no existen no se nombran', async (t) => {
  const { root, run } = await working(t, { wtFiles: { '.github/copilot-instructions.md': 'x', '.cursor/rules/a.mdc': 'x', 'src/CLAUDE.md': 'x' } });
  await run('dispatch', '--spec', A, '--role', 'desarrollador');
  const order = await readFile(orderFile(root, 'desarrollador'), 'utf8');
  for (const piece of ['`.github/copilot-instructions.md`', '`.cursor/rules`', '`src/CLAUDE.md`']) assert.ok(order.includes(piece), piece);
  assert.equal(order.includes('`src/checkout/CLAUDE.md`'), false);
});

test('R5 (en): la orden sale en el idioma del proyecto', async (t) => {
  const { root, run } = await working(t, { language: 'en' });
  await run('dispatch', '--spec', A, '--role', 'desarrollador');
  const order = await readFile(orderFile(root, 'desarrollador'), 'utf8');
  for (const title of [TEXT.en.order.rules, TEXT.en.order.report]) assert.ok(order.includes(title), title);
  assert.equal(order.includes(TEXT.es.order.rules), false);
});

test('R6: con lanzador `comando`, devuelve la línea resuelta con la orden y la carpeta entre comillas', async (t) => {
  const { root, wt, run } = await working(t, { teamJson: { roles: { desarrollador: { launcher: 'comando', command: 'codex exec --file {orden} --cd {carpeta}' } } } });
  const out = await run('dispatch', '--spec', A, '--role', 'desarrollador');
  assert.equal(out.code, 0, out.text);
  assert.ok(out.text.includes(`codex exec --file "${orderFile(root, 'desarrollador')}" --cd "${wt}"`), out.text);
  assert.equal((await last(root)).launcher, 'comando');
});

test('R6: un comando vacío, que no nombra la orden o con caracteres que Windows rechaza, no se entrega', async (t) => {
  for (const [command, problem] of [['', 'no-command'], ['codex exec', 'no-order'], ['codex {orden} && rm -rf x', 'unsafe-command']]) {
    const { root, run } = await working(t, { teamJson: { roles: { desarrollador: { launcher: 'comando', command } } } });
    const out = await run('dispatch', '--spec', A, '--role', 'desarrollador');
    assert.deepEqual([out.code, out.text.includes(TEXT.es.problems[problem]('desarrollador'))], [1, true], problem);
    assert.equal((await last(root)).type, 'started');
    assert.equal(existsSync(orderFile(root, 'desarrollador')), false);
  }
});

test('R7: quien revisa se despacha sobre una entrega, con su commit y dónde deja el veredicto', async (t) => {
  const { root, wt, run } = await working(t);
  const early = await run('dispatch', '--spec', A, '--role', 'revisor');
  assert.deepEqual([early.code, early.text.includes(TEXT.es.problems['wrong-state']('revisor'))], [1, true]);
  await appendEvent(root, { type: 'delivered', spec: A, head: 'abc1234def' });
  const out = await run('dispatch', '--spec', A, '--role', 'revisor');
  assert.equal(out.code, 0, out.text);
  const order = await readFile(orderFile(root, 'revisor'), 'utf8');
  for (const piece of ['.chalc/roles/revisor.md', wt, 'alto', 'abc1234def', '.chalc/review.md']) assert.ok(order.includes(piece), piece);
  assert.equal(order.includes('deliver --spec'), false, 'quien revisa no entrega');
  const late = await run('dispatch', '--spec', A, '--role', 'desarrollador');
  assert.deepEqual([late.code, late.text.includes(TEXT.es.problems['wrong-state']('desarrollador'))], [1, true]);
});

test('R5: tras un rechazo, la orden del desarrollador trae el intento y el hallazgo que tiene que resolver', async (t) => {
  const { root, run } = await working(t);
  for (const event of [{ type: 'delivered', spec: A, head: 'a' }, { type: 'reviewed', spec: A, role: 'revisor', ok: false, findings: 1, summary: 'el test de R2 no comprueba el total' }, { type: 'rework', spec: A }]) await appendEvent(root, event);
  await run('dispatch', '--spec', A, '--role', 'desarrollador');
  const order = await readFile(orderFile(root, 'desarrollador'), 'utf8');
  for (const piece of ['2/3', 'revisor: el test de R2 no comprueba el total']) assert.ok(order.includes(piece), piece);
});

test('R7: un rol que no existe, una spec sin registrar o faltar un dato: se niega sin registrar nada', async (t) => {
  const { root, run } = await working(t);
  const cases = [[['--spec', A, '--role', 'mago'], TEXT.es.problems['unknown-role']('mago')], [['--spec', 'specs/099-nadie', '--role', 'desarrollador'], TEXT.es.problems['not-registered']('specs/099-nadie')],
    [['--spec', A], TEXT.es.dispatchUsage], [['--role', 'revisor'], TEXT.es.dispatchUsage]];
  for (const [args, message] of cases) {
    const out = await run('dispatch', ...args);
    assert.deepEqual([out.code, out.text.includes(message)], [1, true], args.join(' '));
  }
  assert.equal((await last(root)).type, 'started');
});

test('R7: el líder se despacha en el repo principal, en cualquier estado', async (t) => {
  const { root, run } = await working(t);
  assert.equal((await run('dispatch', '--spec', A, '--role', 'lider')).code, 0);
  assert.ok((await readFile(orderFile(root, 'lider'), 'utf8')).includes(root));
});

test('R8: con el tope de paralelismo alcanzado, no se empieza otra spec', async (t) => {
  const { root, run } = await working(t, { teamJson: { maxParallel: 1 } });
  const out = await run('start', '--spec', B);
  assert.deepEqual([out.code, out.text.includes(TEXT.es.problems['parallel-cap'](1))], [1, true]);
  assert.equal((await readStatus(root)).features[0].specs[1].state, 'scheduled');
});

test('R3: `start` toma el lanzador y el nivel del desarrollador de team.json', async (t) => {
  const base = await tempDir(t, 'chalc-034-start-');
  const root = await gitRepo(base, { ...BASE(), '.chalc/team.json': JSON.stringify({ roles: { desarrollador: { launcher: 'comando', tier: 'economico', command: 'codex {orden}' } } }) });
  await team(root, 'open', '--feature', 'pagos', A);
  await team(root, 'waves', '--feature', 'pagos');
  assert.equal((await team(root, 'start', '--spec', A)).code, 0);
  assert.deepEqual((await readStatus(root)).features[0].specs[0].developer, { launcher: 'comando', tier: 'economico' });
});

test('R5: un despacho cuenta como señal de vida de la spec', () => {
  const T = (m) => new Date(Date.parse('2026-11-22T10:00:00.000Z') + m * 60000).toISOString();
  const events = [{ at: T(0), type: 'feature_opened', feature: 'pagos', agent: 'c' }, { at: T(1), type: 'spec_added', feature: 'pagos', spec: A },
    { at: T(2), type: 'started', spec: A, worktree: 'w', branch: 'b', launcher: 'nativo', tier: 'medio' }, { at: T(50), type: 'dispatched', spec: A, role: 'desarrollador', launcher: 'nativo', tier: 'medio' }];
  const spec = reduce(events, { now: Date.parse(T(60)), stallMs: 20 * 60000, maxAttempts: 3 }).features[0].specs[0];
  assert.deepEqual([spec.state, spec.stalled, spec.lastSignal], ['in_dev', false, T(50)]);
});

// ── Spec 037 (evals pasivos), T1 — la versión de las instrucciones de cada despacho (R1) ──────────────────

test('037 R1: el despacho registra la huella de las instrucciones del rol, y cambia cuando cambian', async (t) => {
  const { createHash } = await import('node:crypto');
  const { root, run } = await working(t);
  await run('dispatch', '--spec', A, '--role', 'desarrollador');
  const first = (await last(root)).instructions;
  assert.equal(first, createHash('sha256').update('rol desarrollador\n').digest('hex').slice(0, 8));
  await writeFile(join(root, '.chalc', 'roles', 'desarrollador.md'), 'rol desarrollador, versión nueva\n');
  await run('dispatch', '--spec', A, '--role', 'desarrollador');
  const second = (await last(root)).instructions;
  assert.match(second, /^[0-9a-f]{8}$/);
  assert.notEqual(second, first);
});
