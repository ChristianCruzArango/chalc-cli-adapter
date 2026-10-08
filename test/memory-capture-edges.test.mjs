// spec 015 · Tm (R6, R11–R13) — los bordes de la captura.
//
// Qué concepto se elige cuando el rol escribe un sinónimo o una palabra nueva, cuándo dos reglas son
// la misma, de dónde sale el origen y qué cuenta como «nuevo» desde la última captura.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture } from '../catalog/memory/lib/capture.mjs';
import { readMemory } from '../catalog/memory/lib/store.mjs';

const ENTRY = (date, role, body) => `## ${date} · a1b2c3d4e5 · ${role} · OK\n${body}\n`;

async function repo(files) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-capture-edges-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const withReview = (review, extra = {}) => repo({
  'specs/001-x/tasks.md': '- [ ] **T12b** (R1) — Hacer algo.\n', '.chalc/review.md': review, ...extra
});
const rules = async (root) => (await readMemory(root)).entries.filter((e) => e.kind !== 'decision');
const NOW = new Date('2026-10-07T16:00:00Z');

test('R11: a synonym written by the role maps to its concept; an unknown word is a new concept', async () => {
  const root = await withReview(ENTRY('2026-10-07T15:00:00Z', 'revisor', [
    'Regla aprendida (Money): Redondear a 2 decimales',
    'Regla aprendida (envíos internacionales): Declarar el país de destino'
  ].join('\n')));
  await capture(root, { now: NOW });
  assert.deepEqual((await rules(root)).map((r) => r.concepts[0]).sort(), ['dinero', 'envio-internacional']);
});

test('R2: the same rule written with other case or punctuation is one entry seen twice', async () => {
  const root = await withReview([
    ENTRY('2026-10-07T15:00:00Z', 'revisor', 'Regla aprendida (dinero): Todo valor usa 2 decimales.'),
    ENTRY('2026-10-07T15:05:00Z', 'seguridad', 'Regla aprendida (dinero): todo valor usa 2 decimales')
  ].join('\n'));
  await capture(root, { now: NOW });
  const found = await rules(root);
  assert.equal(found.length, 1);
  assert.equal(found[0].seen, 2);
  assert.equal(found[0].key, 'dinero:todo-valor-usa-2-decimal');
});

test('R11: files are taken from file:line references and from bare file names, without the line', async () => {
  const root = await withReview(ENTRY('2026-10-07T15:00:00Z', 'revisor', 'Regla aprendida (dinero): Redondear — src/a.mjs:12, ver lib/b.dart'));
  await capture(root, { now: NOW });
  const [rule] = await rules(root);
  assert.deepEqual(rule.files, ['src/a.mjs', 'lib/b.dart']);
  assert.equal(rule.title, 'Redondear');
  assert.equal(rule.detail, 'Redondear — src/a.mjs:12, ver lib/b.dart');
});

test('R11: the origin uses the spec folder configured in gate.json and keeps task ids like T12b', async () => {
  const root = await repo({
    '.chalc/gate.json': JSON.stringify({ spec: { dir: 'docs/specs' } }),
    'docs/specs/004-envios/tasks.md': '- [ ] **T12b** (R1) — Algo.\n',
    '.chalc/review.md': ENTRY('2026-10-07T15:00:00Z', 'revisor', 'Regla aprendida (dinero): Redondear')
  });
  await capture(root, { now: NOW });
  assert.deepEqual((await rules(root))[0].origin, { spec: '004-envios', task: 'T12b', role: 'revisor' });
});

test('R11: with every task ticked the origin has no task, and the rule is still stored', async () => {
  const root = await withReview(ENTRY('2026-10-07T15:00:00Z', 'revisor', 'Regla aprendida (dinero): Redondear'), {
    'specs/001-x/tasks.md': '- [x] **T1** (R1) — Hecho.\n'
  });
  await capture(root, { now: NOW });
  assert.equal((await rules(root))[0].origin.task, '');
});

// La captura guarda hasta dónde leyó: lo escrito justo en ese instante ya se leyó.
test('R11: an entry dated exactly at the last capture is not captured again', async () => {
  const root = await withReview(ENTRY('2026-10-07T15:00:00Z', 'revisor', 'Regla aprendida (dinero): Redondear'), {
    '.chalc/memory/state.json': JSON.stringify({ capturedUntil: '2026-10-07T15:00:00.000Z' })
  });
  assert.deepEqual(await capture(root, { now: NOW }), { rules: 0, decisions: 0 });
});

const STATE = (date) => JSON.stringify({ date, verdict: 'pass', suppressions: [{ file: 'src/a.mjs', line: 3, rule: 'weak-hash', reason: 'checksum de caché sin uso criptográfico' }] });

test('R13: decisions are captured once per gate run, and again only after a newer run', async () => {
  const root = await withReview('', { '.chalc/gate.state.json': STATE('2026-10-07T14:00:00Z') });
  assert.equal((await capture(root, { now: NOW })).decisions, 1);
  assert.equal((await capture(root, { now: new Date('2026-10-07T17:00:00Z') })).decisions, 0);

  await writeFile(join(root, '.chalc/gate.state.json'), STATE('2026-10-07T18:00:00Z'));
  assert.equal((await capture(root, { now: new Date('2026-10-07T19:00:00Z') })).decisions, 1);

  const [decision] = (await readMemory(root)).entries.filter((e) => e.kind === 'decision');
  assert.deepEqual([decision.key, decision.seen, decision.origin.role], ['decision:weak-hash:src/a.mjs', 2, 'gate']);
});

test('R11: in a git repo the entry keeps the short commit it was learned at', async () => {
  const root = await withReview(ENTRY('2026-10-07T15:00:00Z', 'revisor', 'Regla aprendida (dinero): Redondear'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  git('init', '-q'); git('add', '-A'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');

  await capture(root, { now: NOW });
  assert.equal((await rules(root))[0].commit, git('rev-parse', '--short=10', 'HEAD'));
});
