// spec 015 · T8–T11 (R15–R19) — el advisor entrega la memoria y exige que se respete.
//
// El advisor sigue siendo de solo lectura: lee la memoria, elige las pocas entradas de la tarea y las
// pone en el motivo, sin cambiar su contrato de tres líneas. Al implementador le dice qué no repetir;
// a cada rol, qué verificar. Y una regla entregada que el rol no confirma deja la tarea sin cerrar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';
import { reasonOf } from '../catalog/next/lib/i18n.mjs';
import { readMemoryFacts } from '../catalog/next/lib/memory.mjs';
import { render } from '../catalog/next/next.mjs';
import { remember } from '../catalog/memory/lib/store.mjs';

const GATE = Date.parse('2026-10-07T15:00:00Z');
const RULE = { id: 'a1b2c3d4', kind: 'bug', title: 'Todo valor monetario usa 2 decimales', files: ['src/cobro.mjs'], stale: false };
const DECISION = { id: 'e5f6a7b8', kind: 'decision', title: 'weak-hash aceptado en src/cobro.mjs', files: ['src/cobro.mjs'], stale: false };
const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }];

const snap = ({ entries = [], log = '', gate = { exists: true, date: GATE, verdict: 'pass' }, changed = ['src/tarifa.mjs'] } = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: '**T2** (R2) — Calcular tarifas', mtime: GATE - 1 },
  gate: { fast: false, scopeHash: 'h', currentScopeHash: 'h', branch: 'b', pending: [], ...gate },
  review: { entries: allReviews(log) },
  changed: { files: changed, newestMtime: changed.length ? GATE - 10 : 0 },
  flow: { approvals: { task: true, feature: true }, roles: ROLES },
  git: { isRepo: true, branch: 'b' },
  memory: { entries },
  problems: []
});

// ── T8 (R15, R18): al implementador ───────────────────────────────────────────────────────────

test('R15: work_task hands the implementer the memory of the task, in both languages', () => {
  const result = decide(snap({ entries: [RULE, DECISION], gate: { exists: false, date: 0, verdict: 'unknown' }, changed: [] }));
  assert.equal(result.action, 'work_task');

  const es = reasonOf('work_task', result.facts, 'es');
  assert.match(es, /a1b2c3d4 \(bug\) Todo valor monetario usa 2 decimales/);
  assert.match(es, /e5f6a7b8 \(decisión\)/);
  assert.match(es, /node \.chalc\/memory\.mjs get <id>/);
  assert.match(reasonOf('work_task', result.facts, 'en'), /a1b2c3d4 \(bug\)/);
});

test('R18: with no memory for the task, the reason does not change', () => {
  const facts = decide(snap({ gate: { exists: false, date: 0, verdict: 'unknown' }, changed: [] })).facts;
  assert.doesNotMatch(reasonOf('work_task', facts, 'es'), /memoria|get <id>/i);
});

// El contrato de tres líneas no se rompe: la memoria va dentro de REASON.
test('R15: the advisor output keeps its three lines with memory in it', () => {
  const facts = decide(snap({ entries: [RULE, DECISION], gate: { exists: false, date: 0, verdict: 'unknown' }, changed: [] })).facts;
  const lines = render({ action: 'work_task', reason: reasonOf('work_task', facts, 'es'), command: '' }).split('\n');
  assert.equal(lines.length, 3);
});

// ── T9 (R16): a los roles ─────────────────────────────────────────────────────────────────────

test('R16: call_role hands the role the rules to verify and the accepted decisions', () => {
  const result = decide(snap({ entries: [RULE, DECISION] }));
  assert.deepEqual([result.action, result.facts.role], ['call_role', 'revisor']);

  const es = reasonOf('call_role', result.facts, 'es');
  assert.match(es, /verifica/i);
  assert.match(es, /a1b2c3d4/);
  assert.match(es, /e5f6a7b8/);
});

// ── T10 (R17): cada regla entregada se confirma ───────────────────────────────────────────────

const ENTRY = (body) => `## 2026-10-07T15:10:00Z · a1b2c3d4e5 · revisor · OK\n${body}`;

test('R17: a role entry that confirms every delivered rule lets the task move on', () => {
  for (const line of ['- Regla a1b2c3d4: cumple — src/tarifa.mjs:12', '- Rule a1b2c3d4: n/a — the task shows no amounts', '- Regla a1b2c3d4: no aplica — la tarea no maneja montos']) {
    assert.equal(decide(snap({ entries: [RULE, DECISION], log: ENTRY(line) })).action, 'tick_task', line);
  }
});

test('R17: a delivered rule without its line stops the cycle and says which one', () => {
  const result = decide(snap({ entries: [RULE], log: ENTRY('') }));
  assert.equal(result.action, 'ask_human');
  assert.ok(result.facts.problems.some((p) => /revisor/.test(p) && /a1b2c3d4: not confirmed/.test(p)), JSON.stringify(result.facts));
});

test('R17: «complies» needs a file:line and «not applicable» needs a reason', () => {
  for (const line of ['- Regla a1b2c3d4: cumple — revisado', '- Regla a1b2c3d4: no aplica — no']) {
    assert.equal(decide(snap({ entries: [RULE], log: ENTRY(line) })).action, 'ask_human', line);
  }
});

// Las decisiones se entregan para no reportarlas otra vez; no se confirman.
test('R17: decisions are not confirmed, only rules and bugs', () => {
  assert.equal(decide(snap({ entries: [DECISION], log: ENTRY('') })).action, 'tick_task');
});

// ── T11 (R19) y la lectura real ───────────────────────────────────────────────────────────────

const git = (root, ...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();

async function repo() {
  const root = await mkdtemp(join(tmpdir(), 'chalc-next-memory-'));
  const files = {
    'specs/001-tienda/spec.md': 'Conceptos: dinero\n- **R2** — WHEN se calcula la tarifa THE SYSTEM SHALL sumarla.\n',
    'specs/001-tienda/tasks.md': '- [ ] **T2** (R2) — Calcular tarifas.\n',
    'src/cobro.mjs': 'export const a = 1;\n',
    'src/fecha.mjs': 'export const b = 1;\n'
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  return { root, commit: git(root, 'rev-parse', '--short=10', 'HEAD') };
}

test('R15: the advisor reads only the entries of the task concepts from the repo memory', async () => {
  const { root, commit } = await repo();
  await remember(root, { key: 'dinero:2-decimales', kind: 'rule', concepts: ['dinero'], title: 'Todo valor monetario usa 2 decimales', files: ['src/cobro.mjs'], commit });
  await remember(root, { key: 'fechas:utc', kind: 'rule', concepts: ['fechas'], title: 'Guardar fechas en UTC', files: ['src/fecha.mjs'], commit });

  const { entries } = await readMemoryFacts(root, { task: '**T2** (R2) — Calcular tarifas.' });
  assert.deepEqual(entries.map((e) => [e.title, e.stale]), [['Todo valor monetario usa 2 decimales', false]]);
});

test('R19: an entry whose files changed since its commit, or are gone, is marked possibly stale', async () => {
  const { root, commit } = await repo();
  await remember(root, { key: 'dinero:a', kind: 'rule', concepts: ['dinero'], title: 'Regla A del dinero', files: ['src/cobro.mjs'], commit });
  await remember(root, { key: 'dinero:b', kind: 'rule', concepts: ['dinero'], title: 'Regla B del dinero', files: ['src/borrado.mjs'], commit });
  await writeFile(join(root, 'src/cobro.mjs'), 'export const a = 2;\n');

  const { entries } = await readMemoryFacts(root, { task: '**T2** (R2) — Calcular tarifas.' });
  assert.deepEqual(entries.map((e) => [e.title, e.stale]).sort(), [['Regla A del dinero', true], ['Regla B del dinero', true]]);
  assert.match(reasonOf('work_task', { task: 'T2', done: 0, total: 1, memory: entries }, 'es'), /posible-vieja/);
});

test('R18: a repo with no memory gives no entries and does not fail', async () => {
  const { root } = await repo();
  await rm(join(root, '.chalc'), { recursive: true, force: true });
  assert.deepEqual((await readMemoryFacts(root, { task: 'T2' })).entries, []);
});

// Encontrado al correr la suite: un repo con el advisor emitido pero sin `.chalc/memory/` hacía que el
// advisor entero no cargara. La memoria ayuda; su ausencia no puede tumbar el ciclo.
test('R18: an equipped repo without the memory tree keeps a working advisor', async () => {
  const { emitGate } = await import('../lib/gateemit.mjs');
  const { emitNext } = await import('../lib/nextemit.mjs');
  const root = await mkdtemp(join(tmpdir(), 'chalc-no-memory-'));
  await emitGate(root, { language: 'es' });
  await emitNext(root);

  const { readMemoryFacts: emitted } = await import(pathToFileURL(join(root, '.chalc', 'next', 'lib', 'memory.mjs')).href);
  assert.deepEqual(await emitted(root, { task: 'T1' }), { concepts: [], entries: [] });
});

test('R19: without a commit an entry is not marked stale, and an entry without files never is', async () => {
  const { root } = await repo();
  await remember(root, { key: 'dinero:sin-commit', kind: 'rule', concepts: ['dinero'], title: 'Regla sin commit del dinero', files: ['src/cobro.mjs'] });
  await remember(root, { key: 'dinero:sin-archivos', kind: 'rule', concepts: ['dinero'], title: 'Regla sin archivos del dinero', commit: 'abc1234567' });
  await writeFile(join(root, 'src/cobro.mjs'), 'export const a = 3;\n');

  const { entries } = await readMemoryFacts(root, { task: '**T2** (R2) — Calcular tarifas.' });
  assert.deepEqual(entries.map((e) => e.stale), [false, false]);
});

test('R18: a spec reader that fails leaves the advisor without memory, not broken', async () => {
  const { root, commit } = await repo();
  await remember(root, { key: 'dinero:a', kind: 'rule', concepts: ['dinero'], title: 'Regla A', files: ['src/cobro.mjs'], commit });
  const failing = async () => { throw new Error('disco roto'); };
  assert.deepEqual(await readMemoryFacts(root, { task: 'T2', findSpec: failing }), { concepts: [], entries: [] });
});

// Encontrado en la prueba de punta a punta: la regla que nace de la revisión de una tarea no puede
// exigírsele a esa misma revisión, que la escribió antes de que existiera.
test('R17: a rule learned after the role reviewed is not demanded from that review', () => {
  const learnedLater = { ...RULE, learned: '2026-10-07T16:00:00Z' };
  const learnedBefore = { ...RULE, learned: '2026-10-07T14:00:00Z' };
  assert.equal(decide(snap({ entries: [learnedLater], log: ENTRY('') })).action, 'tick_task');
  assert.equal(decide(snap({ entries: [learnedBefore], log: ENTRY('') })).action, 'ask_human');
});

// Una tarea que no nombra ningún concepto recibe la memoria de los que declara su spec: la spec
// importa, y se busca en la carpeta configurada.
test('R10: the spec concepts line decides the memory of a task that names no concept', async () => {
  const { root, commit } = await repo();
  await writeFile(join(root, 'specs/001-tienda/spec.md'), 'Conceptos: fechas\n- **R2** — WHEN algo THE SYSTEM SHALL otra cosa.\n');
  await remember(root, { key: 'fechas:utc', kind: 'rule', concepts: ['fechas'], title: 'Guardar fechas en UTC', files: ['src/fecha.mjs'], commit });

  const facts = await readMemoryFacts(root, { task: '**T2** (R2) — Hacer algo.' });
  assert.deepEqual([facts.concepts, facts.entries.map((e) => e.title)], [['fechas'], ['Guardar fechas en UTC']]);
});

test('R18: with no spec found the task text alone decides, and an empty memory is fully empty', async () => {
  const { root, commit } = await repo();
  assert.deepEqual(await readMemoryFacts(root, { task: 'T2' }), { concepts: [], entries: [] });

  await remember(root, { key: 'dinero:a', kind: 'rule', concepts: ['dinero'], title: 'Regla A', files: ['src/cobro.mjs'], commit });
  const facts = await readMemoryFacts(root, { task: 'calcular tarifas', findSpec: async () => null });
  assert.deepEqual(facts.entries.map((e) => e.title), ['Regla A']);
});

// Encontrado en la prueba de punta a punta: si se marca la tarea antes de capturar, la captura cree
// que la tarea en curso es la siguiente y la regla pierde su origen (y su marca `[bug]`). El motivo
// fija el orden.
test('R11: tick_task says to run the capture command before ticking the task', () => {
  const facts = { task: '**T3** `[bug]` — Montos', done: 1, total: 3, waitForApproval: true };
  assert.match(reasonOf('tick_task', facts, 'es'), /primero corre el COMMAND[^.]*y después marca/i);
  assert.match(reasonOf('tick_task', facts, 'en'), /first run the COMMAND[^.]*then tick/i);
});

test('R15: a long title is cut at a word boundary, with an ellipsis', () => {
  const long = { ...RULE, title: 'amounts are validated and kept as safe integers in minor units and converted to the gateway string with integer arithmetic' };
  const reason = reasonOf('work_task', { task: 'T2', done: 0, total: 1, memory: [long] }, 'en');
  const shown = reason.match(/a1b2c3d4 \(bug\) (.*?)… \[/)[1];
  assert.ok(long.title.startsWith(`${shown} `), `corta en una palabra completa: «${shown}»`);
  assert.ok(shown.length <= 90);
});
