// spec 014 · T27 (R29) — el advisor comprueba la checklist del rol de seguridad.
//
// Un `OK` a secas no prueba que se revisó nada. El rol de seguridad deja una línea por categoría
// OWASP (y MASVS en móvil): `revisado — archivo:línea` o `no aplica — motivo`. El advisor la lee y,
// si falta una categoría, si un `revisado` no cita líneas de la tarea, si un `no aplica` no explica
// por qué o si `FINDINGS: n` no cuadra con los puntos, NO cierra la tarea: devuelve el control.
//
// El advisor no conoce el rol por su nombre: valida la entrada de todo rol que DECLARA una checklist.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { checklistProblems } from '../catalog/next/lib/checklist.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';
import { isMobileRepo } from '../catalog/next/lib/snapshot.mjs';
import { detectGateConfig } from '../lib/gatedetect.mjs';

const OWASP = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'];
const MASVS = ['STORAGE', 'CRYPTO', 'AUTH', 'NETWORK', 'PLATFORM', 'CODE', 'RESILIENCE', 'PRIVACY'].map((g) => `MASVS-${g}`);
const SCOPE = ['lib/pagos/pago_service.dart', 'lib/pagos/pago_repo.dart'];

// Una checklist completa: la mitad revisada con líneas de la tarea, la otra mitad «no aplica».
const lines = (ids, over = {}) => ids.map((id, i) => over[id] ?? (i % 2
  ? `- ${id} Categoría: no aplica — la tarea no toca esto`
  : `- ${id} Categoría: revisado — lib/pagos/pago_service.dart:${10 + i}`));

const entry = ({ verdict = 'OK', ids = OWASP, over = {}, findings = [] } = {}) => [
  `## 2026-10-07T15:04:02Z · a1b2c3d4e5 · seguridad · ${verdict}`,
  ...lines(ids, over),
  ...findings.map((f, i) => `${i + 1}. ${f}`)
].join('\n');

const parse = (text) => allReviews(text)[0];
const problems = (text, { mobile = false } = {}) => checklistProblems(parse(text), { kind: 'owasp', mobile, scope: SCOPE });

// ── la lectura ────────────────────────────────────────────────────────────────────────────────

test('R29: the log reader keeps each entry checklist and counts its numbered items', () => {
  const read = parse(entry({ verdict: 'FINDINGS: 1', findings: ['lib/pagos/pago_service.dart:42 — A01 IDOR'] }));

  assert.equal(read.checklist.A01.status, 'reviewed');
  assert.deepEqual(read.checklist.A01.refs, ['lib/pagos/pago_service.dart:10']);
  assert.equal(read.checklist.A02.status, 'na');
  assert.equal(read.checklist.A02.reason, 'la tarea no toca esto');
  assert.equal(read.numbered, 1);
});

test('R29: the checklist words are read in both languages', () => {
  const text = entry({ over: { A01: '- A01 Access control: reviewed — lib/pagos/pago_repo.dart:3', A02: '- A02 Crypto: n/a — the task stores nothing' } });
  assert.deepEqual(problems(text), []);
});

// ── las reglas ────────────────────────────────────────────────────────────────────────────────

test('R29: a complete checklist has no problems', () => {
  assert.deepEqual(problems(entry()), []);
});

test('R29: a missing category is a problem', () => {
  assert.deepEqual(problems(entry({ ids: OWASP.filter((id) => id !== 'A04') })), ['A04: missing']);
});

test('R29: on a mobile repo the eight MASVS groups are required too', () => {
  assert.deepEqual(problems(entry(), { mobile: true }), MASVS.map((id) => `${id}: missing`));
  assert.deepEqual(problems(entry({ ids: [...OWASP, ...MASVS] }), { mobile: true }), []);
});

test('R29: «reviewed» must cite at least one file:line from the task scope', () => {
  const none = entry({ over: { A01: '- A01 Control de acceso: revisado — todo bien' } });
  assert.deepEqual(problems(none), ['A01: reviewed without file:line from the task']);

  const outside = entry({ over: { A01: '- A01 Control de acceso: revisado — lib/otro/archivo.dart:5' } });
  assert.deepEqual(problems(outside), ['A01: reviewed without file:line from the task']);
});

test('R29: «not applicable» needs a reason of at least three words', () => {
  for (const reason of ['', 'n/a', 'no aplica']) {
    const text = entry({ over: { A02: `- A02 Criptografía: no aplica — ${reason}` } });
    assert.deepEqual(problems(text), ['A02: not applicable without a reason'], reason);
  }
});

test('R29: FINDINGS: n must match the numbered items', () => {
  const text = entry({ verdict: 'FINDINGS: 2', findings: ['lib/pagos/pago_service.dart:42 — A01 IDOR'] });
  assert.deepEqual(problems(text), ['FINDINGS: 2 but 1 numbered item(s)']);
});

// ── el advisor ────────────────────────────────────────────────────────────────────────────────

const GATE = Date.parse('2026-10-07T15:00:00Z');
const ROLES = [
  { id: 'seguridad', order: 5, cadence: 'task', required: true, checklist: 'owasp' },
  { id: 'revisor', order: 10, cadence: 'task', required: true }
];
const snap = (log, { mobile = false } = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: 'T2 — pagar', mtime: GATE - 1 },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, branch: 'b', pending: [] },
  review: { entries: allReviews(log) },
  changed: { files: SCOPE, newestMtime: GATE - 10 },
  flow: { approvals: { task: true, feature: true }, roles: ROLES },
  git: { isRepo: true, branch: 'b' },
  platform: { mobile },
  problems: []
});
const REVISOR_OK = '## 2026-10-07T15:10:00Z · a1b2c3d4e5 · revisor · OK';

test('R29: a valid checklist lets the cycle move on', () => {
  assert.equal(decide(snap(`${entry()}\n${REVISOR_OK}`)).action, 'tick_task');
});

test('R29: an invalid checklist stops the cycle and says what is wrong', () => {
  const result = decide(snap(`${entry({ ids: OWASP.slice(0, 9) })}\n${REVISOR_OK}`));

  assert.equal(result.action, 'ask_human');
  assert.ok(result.facts.problems.some((p) => /seguridad/.test(p) && /A10: missing/.test(p)), JSON.stringify(result.facts));
});

test('R29: on a mobile repo, a checklist without MASVS does not close the task', () => {
  assert.equal(decide(snap(`${entry()}\n${REVISOR_OK}`, { mobile: true })).action, 'ask_human');
});

// Solo se valida la entrada que cuenta: una de antes de la evidencia mira otro código y ya no decide.
test('R29: an old entry from before the evidence is not validated', () => {
  const old = entry({ ids: ['A01'] }).replace('2026-10-07T15:04:02Z', '2026-10-07T14:00:00Z');
  const result = decide(snap(old));
  assert.deepEqual([result.action, result.facts.role], ['call_role', 'seguridad']);
});

// Los roles sin checklist declarada siguen leyéndose solo por su encabezado.
test('R29: roles that declare no checklist are not affected', () => {
  assert.equal(decide(snap(`${entry()}\n${REVISOR_OK}`)).action, 'tick_task');
});

// ── de dónde salen los datos ──────────────────────────────────────────────────────────────────

test('R29: a repo with an android/ or ios/ folder is mobile', async () => {
  const plain = await mkdtemp(join(tmpdir(), 'chalc-mobile-'));
  assert.equal(isMobileRepo(plain), false);

  for (const folder of ['android', 'ios']) {
    const repo = await mkdtemp(join(tmpdir(), 'chalc-mobile-'));
    await mkdir(join(repo, folder));
    assert.equal(isMobileRepo(repo), true, folder);
  }
});

test('R29: equipping writes the checklist the security role declares into gate.json', async () => {
  const { flow } = await detectGateConfig(await mkdtemp(join(tmpdir(), 'chalc-checklist-')));
  assert.equal(flow.roles.find((r) => r.id === 'seguridad').checklist, 'owasp');
  assert.equal(flow.roles.find((r) => r.id === 'revisor').checklist, undefined);
});
