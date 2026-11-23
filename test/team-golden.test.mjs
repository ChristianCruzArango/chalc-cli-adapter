// Specs 032, 034, 036, 037 — la salida EXACTA de lo que lee una persona: la tabla de estado, el informe, la orden de
// un rol y las cifras del equipo. Los tests por piezas comprueban que cada dato aparece; estos fijan la forma
// entera —orden, separadores, líneas en blanco—, que es lo que un cambio descuidado rompe sin que nadie lo note.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce } from '../catalog/team/lib/reduce.mjs';
import { renderStatus } from '../catalog/team/lib/render.mjs';
import { renderReport } from '../catalog/team/lib/report.mjs';
import { orderText } from '../catalog/team/lib/order.mjs';
import { EVENTS as VOCABULARY, eventProblem } from '../catalog/team/lib/events.mjs';

const T = (m) => new Date(Date.parse('2026-11-22T10:00:00.000Z') + m * 60000).toISOString();
const A = 'specs/027-checkout';
const B = 'specs/028-recibos';
const EVENTS = [
  { at: T(0), type: 'feature_opened', feature: 'pagos', agent: 'claude' }, { at: T(1), type: 'spec_added', feature: 'pagos', spec: A }, { at: T(1), type: 'spec_added', feature: 'pagos', spec: B },
  { at: T(5), type: 'started', spec: A, worktree: 'w', branch: 'b', launcher: 'codex', tier: 'medio' },
  { at: T(6), type: 'signal', spec: A, phase: 'GREEN', task: 'T2' },
  { at: T(20), type: 'gate', spec: A, verdict: 'pass', stage: '', score: 92, fast: false }, { at: T(30), type: 'delivered', spec: A, head: 'a1' },
  { at: T(31), type: 'reviewed', spec: A, role: 'revisor', ok: false, findings: 1, summary: 'falta R2' },
  { at: T(44), type: 'blocked', spec: B, reason: 'falta la clave' }, { at: T(45), type: 'lead', feature: 'pagos', action: 'integrando' },
  { at: T(46), type: 'needs_human', feature: 'pagos', reason: 'desbloquear', command: 'node .chalc/team.mjs status' }
];
const OPTS = { now: Date.parse(T(90)), stallMs: 20 * 60000, maxAttempts: 3 };

test('032 R8: la tabla de estado, entera', () => {
  assert.equal(renderStatus(reduce(EVENTS, OPTS), 'es'), "Equipo · actualizado 2026-11-22 11:30\n\n⏳ Espera al usuario: pagos — desbloquear → node .chalc/team.mjs status\n\nFeature pagos · líder claude: integrando\n  spec                estado     desarrollador  fase   tarea  intento  portón    última señal\n  specs/027-checkout  rechazada  codex · medio  GREEN  T2     1/3      pass 92%  2026-11-22 10:31\n  specs/028-recibos   bloqueada  —              —      —      0/3      —         2026-11-22 10:44\n    specs/027-checkout: revisor: falta R2\n    specs/028-recibos: falta la clave\n");
});

test('032 R8: sin equipo, con una feature sin specs, cerrada, y con un posible atasco', () => {
  assert.equal(renderStatus(reduce([], OPTS), 'es'), 'Equipo · actualizado 2026-11-22 11:30\n\nTodavía no hay ninguna feature registrada.\n');
  const closed = [EVENTS[0], { at: T(2), type: 'closed', feature: 'pagos' }];
  assert.equal(renderStatus(reduce(closed, OPTS), 'es'), 'Equipo · actualizado 2026-11-22 11:30\n\nFeature pagos · líder claude · cerrada\n');
  const stuck = renderStatus(reduce(EVENTS.slice(0, 4), OPTS), 'es').split('\n');
  assert.deepEqual(stuck.slice(-3), ['  specs/028-recibos   borrador       —              —     —      0/3      —       2026-11-22 10:01', '    specs/027-checkout: ⚠ posible atasco: sin señal', '']);
  assert.equal(stuck[4], '  specs/027-checkout  en desarrollo  codex · medio  —     —      1/3      —       2026-11-22 10:05');
});

test('032 R10, R11: el informe, entero', () => {
  assert.equal(renderReport(EVENTS, 'pagos', { lang: 'es', ...OPTS }), "# Informe de la feature pagos\n\nlíder claude · abierta · generado 2026-11-22 11:30\n\nDerivado del registro del equipo (.chalc/team/ledger.jsonl): hechos fechados, no un resumen redactado.\n\n## specs/027-checkout — rechazada\n- Intentos: 1 / 3\n- Rechazos:\n  - revisor (2026-11-22 10:31): falta R2\n- Último portón: pass 92% · completo\n\n## specs/028-recibos — bloqueada\n- Intentos: 0 / 3\n- Rechazos: ninguno\n- Último portón: sin ninguna corrida\n- Bloqueo: falta la clave\n\n## Lo que NO se verificó\n- specs/027-checkout: no quedó integrada (rechazada)\n- specs/028-recibos: no quedó integrada (bloqueada)\n- specs/028-recibos: sin una corrida completa del portón que apruebe\n- El cierre de la feature no lo ha aprobado el usuario.\n");
  assert.equal(renderReport(EVENTS, 'otra', { lang: 'es', ...OPTS }), '# Informe de la feature otra\n\nNo hay ninguna feature «otra» en el registro.\n');
});

test('032 R10: una corrida rápida del portón se dice, y un estado desconocido se muestra tal cual', () => {
  const fast = [...EVENTS.slice(0, 4), { at: T(20), type: 'gate', spec: A, verdict: 'pass', stage: 'tests', score: 81, fast: true }];
  assert.ok(renderReport(fast, 'pagos', { lang: 'es', ...OPTS }).includes('- Último portón: pass tests 81% --fast · rápido (--fast)\n'));
  assert.ok(renderStatus(reduce(fast, OPTS), 'es').includes('pass tests 81% --fast'));
  const odd = reduce(fast, OPTS);
  odd.features[0].specs[0].state = 'inventado';
  assert.ok(renderStatus(odd, 'es').includes('specs/027-checkout  inventado'));
});

test('034 R5, 036 R5, 040 R5: la orden de quien revisa, entera', () => {
  const order = orderText({ lang: 'es', role: 'revisor', kind: 'reviewer', spec: A, dir: '/wt/027', launcher: 'nativo', tier: 'alto', attempt: 2, maxAttempts: 3, head: 'abc1234', gallery: '/wt/027/g.html',
    rules: ['CLAUDE.md'], skills: [], finding: '', lessons: [{ id: 'ab12', title: 'Validar en servidor', promoted: true }, { id: 'cd34', title: 'Otra', promoted: false }] });
  assert.equal(order, "# Orden: revisor · specs/027-checkout\n\n- Tus instrucciones (léelas primero): `.chalc/roles/revisor.md`\n- Carpeta donde trabajas: /wt/027\n- Lanzador y nivel de modelo: nativo · alto\n- Intento: 2/3\n- Commit entregado que revisas: abc1234\n- Galería de capturas medidas: /wt/027/g.html\n\n## Reglas propias del proyecto (mandan sobre tus costumbres)\n- `CLAUDE.md`\n\n## Skills que aplicas\n- Ninguna configurada para este rol: usa las de tus instrucciones.\n\n## La spec\n- `specs/027-checkout/hu.md`\n- `specs/027-checkout/spec.md`\n- `specs/027-checkout/plan.md`\n- `specs/027-checkout/tasks.md`\n\n## Lecciones vigentes del proyecto (otros ya tropezaron con esto)\n- [ab12] Validar en servidor (regla de todo el equipo)\n- [cd34] Otra\nEl detalle de cada una: `node .chalc/memory.mjs get <id>`\n\n## Cómo informas\n- Señal de vida: `node .chalc/team.mjs event signal spec=specs/027-checkout`\n- Si no puedes seguir: `node .chalc/team.mjs block --spec specs/027-checkout \"<qué falta y por qué>\"`\n- Tu veredicto va en `.chalc/review.md` de esta carpeta, sobre el commit abc1234: sin esa entrada tu revisión no cuenta.\n");
});

test('034 R5: la orden de quien desarrolla, entera', () => {
  const order = orderText({ lang: 'es', role: 'desarrollador', kind: 'developer', spec: A, dir: '/wt/027', launcher: 'comando', tier: 'medio', attempt: 1, maxAttempts: 3, head: '', gallery: '',
    rules: [], skills: ['clean-code'], finding: 'revisor: falta R2', lessons: [] });
  assert.equal(order, "# Orden: desarrollador · specs/027-checkout\n\n- Tus instrucciones (léelas primero): `.chalc/roles/desarrollador.md`\n- Carpeta donde trabajas: /wt/027\n- Lanzador y nivel de modelo: comando · medio\n- Intento: 1/3\n\n## Reglas propias del proyecto (mandan sobre tus costumbres)\n- El proyecto no tiene archivos de reglas propios.\n\n## Skills que aplicas\n- `clean-code`\n\n## La spec\n- `specs/027-checkout/hu.md`\n- `specs/027-checkout/spec.md`\n- `specs/027-checkout/plan.md`\n- `specs/027-checkout/tasks.md`\n\n## Hallazgo que tienes que resolver\nrevisor: falta R2\n\n## Cómo informas\n- Señal de vida: `node .chalc/team.mjs event signal spec=specs/027-checkout`\n- Si no puedes seguir: `node .chalc/team.mjs block --spec specs/027-checkout \"<qué falta y por qué>\"`\n- Entrega: `node .chalc/team.mjs deliver --spec specs/027-checkout`\n");
  // Otro rol del equipo: ni entrega ni veredicto, y sin lecciones la sección no existe aunque no se pase la lista.
  const other = orderText({ lang: 'es', role: 'lider', kind: 'other', spec: A, dir: '/repo', launcher: 'nativo', tier: 'alto', attempt: 0, maxAttempts: 3, head: '', gallery: '', rules: [], skills: [], finding: '' });
  assert.equal(other.includes('deliver --spec') || other.includes('Tu veredicto') || other.includes('Lecciones') || other.includes('Commit entregado'), false);
  assert.ok(other.endsWith('"<qué falta y por qué>"`\n'));
});

test('032 R3: el vocabulario de eventos, completo: cada tipo con sus campos obligatorios', () => {
  assert.deepEqual(VOCABULARY, {
    feature_opened: ['feature', 'agent'], spec_added: ['feature', 'spec'], spec_approved: ['spec'], scheduled: ['spec', 'wave'],
    started: ['spec', 'worktree', 'branch', 'launcher', 'tier'], signal: ['spec'], dispatched: ['spec', 'role', 'launcher', 'tier'], gate: ['spec', 'verdict'],
    delivered: ['spec', 'head'], reviewed: ['spec', 'role', 'ok', 'findings', 'summary'], rework: ['spec'], relaunched: ['spec', 'tier'], escalated: ['spec', 'reason'],
    blocked: ['spec', 'reason'], unblocked: ['spec'], integrated: ['spec', 'head'], lead: ['feature', 'action'], needs_human: ['feature', 'reason', 'command'], human_done: ['feature'], closed: ['feature']
  });
  assert.ok(Object.isFrozen(VOCABULARY));
});

test('032 R3: a cada tipo le falta exactamente su primer campo cuando llega vacío', () => {
  for (const [type, fields] of Object.entries(VOCABULARY)) {
    assert.equal(eventProblem({ type }), `missing:${fields[0]}`, type);
    const full = Object.fromEntries(fields.map((field) => [field, 'x']));
    assert.equal(eventProblem({ type, ...full }), '', type);
    assert.equal(eventProblem({ type, ...full, [fields.at(-1)]: null }), `missing:${fields.at(-1)}`, type);
  }
  assert.equal(eventProblem({ type: 'blocked', spec: 's', reason: 0 }), '', 'un número no es una ausencia');
  assert.equal(eventProblem([]), 'unknown-type');
});

// ── Spec 037 — las cifras del equipo, enteras ────────────────────────────────────────────────────────────
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { main } from '../catalog/team/team.mjs';
import { appendEvent } from '../catalog/team/lib/ledger.mjs';

test('037 R2, R3, R4: `evals`, entero', async (t) => {
  const root = await tempDir(t, 'chalc-037-golden-');
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ language: 'es' }));
  let minute = 0;
  const now = () => new Date(Date.parse(T(0)) + (minute += 1) * 60000);
  for (const event of [
    { type: 'feature_opened', feature: 'pagos', agent: 'c' }, { type: 'spec_added', feature: 'pagos', spec: A },
    { type: 'started', spec: A, worktree: 'w', branch: 'b', launcher: 'nativo', tier: 'medio' }, { type: 'dispatched', spec: A, role: 'desarrollador', launcher: 'nativo', tier: 'medio', instructions: 'v1' },
    { type: 'delivered', spec: A, head: 'a' }, { type: 'dispatched', spec: A, role: 'revisor', launcher: 'nativo', tier: 'alto', instructions: 'r1' },
    { type: 'reviewed', spec: A, role: 'revisor', ok: true, findings: 0, summary: 'OK' }, { type: 'integrated', spec: A, head: 'i' }
  ]) await appendEvent(root, event, { now });
  const lines = [];
  assert.equal(await main({ argv: ['node', 'team.mjs', 'evals', '--root', root], cwd: root, write: (line) => lines.push(line) }), 0);
  assert.equal(lines.join('\n'), [
    'Evals del equipo (del registro, sin modelos) · 1 spec(s) · 1 integrada(s)', '',
    'Desarrollador, por nivel de modelo y versión de sus instrucciones',
    '  nivel  instrucciones  entregas  a la primera  aprobadas  rechazadas  relanzadas  escaladas',
    '  medio  v1             1         1             1          0           0           0', '',
    'Quien revisa, por rol y versión de sus instrucciones',
    '  rol      instrucciones  veredictos  rechazos',
    '  revisor  r1             1           0', '',
    'Integración: 1 uniones buenas · 0 rompieron al unirse · 0 conflictos',
    // El reloj de la prueba avanza dos minutos por evento (uno al fecharlo y otro al rehacer el estado): de
    // empezar (3.er evento) a integrar (8.º) van 10.
    'Tiempo medio de empezar a integrar: 10 min', '',
    'Son conteos, no un juicio: con pocas entregas no distinguen una mejora de la suerte.'
  ].join('\n'));
});

test('037 R4, R6: sin ninguna spec integrada el tiempo medio es «—», y basta un veredicto para que haya cifras', async (t) => {
  const root = await tempDir(t, 'chalc-037-golden-');
  for (const event of [{ type: 'feature_opened', feature: 'f', agent: 'c' }, { type: 'spec_added', feature: 'f', spec: A }, { type: 'reviewed', spec: A, role: 'revisor', ok: false, findings: 1, summary: 'x' }]) await appendEvent(root, event);
  const lines = [];
  await main({ argv: ['node', 'team.mjs', 'evals', '--root', root], cwd: root, write: (line) => lines.push(line) });
  const text = lines.join('\n');
  assert.ok(text.includes('Average time from start to integrated: —'), text);
  assert.ok(text.includes('  revisor  ?             1         1'), text);
});
