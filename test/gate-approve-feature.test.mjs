// Spec 028 (puertas humanas), T1 — el cierre lo aprueba el usuario, desde su terminal (R2, R3, R10): con la spec
// aprobada, todas las tareas marcadas y una evidencia completa que aprueba. Cada aprobación deja rastro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { coherentSpec, coherentTexts } from './helpers/coherentspec.mjs';
import { main } from '../catalog/gate/gate.mjs';
import { approveFeature } from '../catalog/gate/lib/approvefeature.mjs';
import { approveSpec } from '../catalog/gate/lib/approve.mjs';
import { parseSeal, readSeal, sealPath, writeSeal } from '../catalog/gate/lib/specseal.mjs';
import { specFingerprint } from '../catalog/gate/lib/specprint.mjs';
import { FRAME } from '../catalog/gate/lib/i18n.mjs';

const DIR = 'specs/007-carrito';
const EVIDENCE = '2026-11-22T11:00:00.000Z';
const STATE = { date: EVIDENCE, verdict: 'pass', fast: false };
const CONFIG = { stack: 'js', test: { command: 'npm test' }, spec: { dir: 'specs' }, language: 'es' };
const ticked = (texts) => ({ ...texts, 'tasks.md': texts['tasks.md'].replace(/\[ \]/g, '[x]') });
const TYPED = { isTTY: true, ask: async () => '007-carrito', head: async () => 'abc1234def', now: () => new Date('2026-11-22T12:00:00.000Z') };

async function project(t, { texts = ticked(coherentTexts(['R1', 'R2'])), sealed = true, state = STATE } = {}) {
  const root = await tempDir(t, 'chalc-028-close-');
  const files = { '.chalc/gate.json': JSON.stringify(CONFIG), ...coherentSpec(DIR, { texts, sealed }) };
  if (state) files['.chalc/gate.state.json'] = JSON.stringify(state);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return root;
}
const approvals = async (root) => (existsSync(join(root, '.chalc', 'approvals.jsonl'))
  ? (await readFile(join(root, '.chalc', 'approvals.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line)) : []);

test('R2: cada spec tiene su sello de cierre, aparte del de la spec', () => {
  assert.equal(sealPath('/r', DIR, 'feature'), join('/r', '.chalc', 'seals', '007-carrito.feature.json'));
  assert.equal(sealPath('/r', DIR), join('/r', '.chalc', 'seals', '007-carrito.spec.json'));
});

test('R2: con todo en su sitio sella carpeta, huella, evidencia, commit y fecha', async (t) => {
  const texts = ticked(coherentTexts(['R1', 'R2']));
  const root = await project(t, { texts });
  const out = await approveFeature(root, { specDir: 'specs', ...TYPED });
  assert.deepEqual(out, { ok: true, reason: '', dir: DIR, file: sealPath(root, DIR, 'feature') });
  assert.deepEqual(await readSeal(root, DIR, 'feature'), {
    dir: DIR, fingerprint: specFingerprint(texts), evidence: EVIDENCE, head: 'abc1234def', date: '2026-11-22T12:00:00.000Z', approvedBy: 'user'
  });
});

test('R2: el sello de cierre no se confunde con el de la spec, ni al revés', async (t) => {
  const root = await project(t);
  await approveFeature(root, { specDir: 'specs', ...TYPED });
  assert.ok(await readSeal(root, DIR), 'el de la spec sigue ahí');
  assert.equal(parseSeal(await readFile(sealPath(root, DIR, 'feature'), 'utf8')), null, 'leído como sello de spec no vale');
  assert.equal(parseSeal(await readFile(sealPath(root, DIR), 'utf8'), 'feature'), null, 'y el de la spec no vale como cierre');
});

test('R3: se niega, diciendo por qué, si falta cualquiera de las condiciones', async (t) => {
  const open = coherentTexts(['R1', 'R2']);
  const half = { ...open, 'tasks.md': open['tasks.md'].replace('[ ]', '[x]') };
  const cases = [
    ['spec-not-approved', { sealed: false }],
    ['tasks-open', { texts: open }],
    ['tasks-open', { texts: half }],
    ['no-evidence', { state: null }],
    ['evidence-not-pass', { state: { ...STATE, verdict: 'fail' } }],
    ['evidence-not-pass', { state: { ...STATE, verdict: 'blocked' } }],
    ['evidence-fast', { state: { ...STATE, fast: true } }],
    ['evidence-fast', { state: { date: EVIDENCE, verdict: 'pass' } }]
  ];
  for (const [reason, setup] of cases) {
    const root = await project(t, setup);
    const out = await approveFeature(root, { specDir: 'specs', ...TYPED });
    assert.deepEqual([out.ok, out.reason], [false, reason], JSON.stringify(setup));
    assert.equal(existsSync(sealPath(root, DIR, 'feature')), false, reason);
  }
});

test('R3: sin carpeta de spec, sin terminal o con otro nombre tecleado no se sella', async (t) => {
  const empty = await tempDir(t, 'chalc-028-close-');
  assert.equal((await approveFeature(empty, { specDir: 'specs', ...TYPED })).reason, 'no-spec');
  const root = await project(t);
  let asked = false;
  const noTty = await approveFeature(root, { specDir: 'specs', ...TYPED, isTTY: false, ask: async () => { asked = true; return '007-carrito'; } });
  assert.deepEqual([noTty.reason, asked], ['no-terminal', false]);
  assert.equal((await approveFeature(root, { specDir: 'specs', ...TYPED, ask: async () => 'si' })).reason, 'name-mismatch');
  assert.equal(existsSync(sealPath(root, DIR, 'feature')), false);
});

test('R3: un estado del portón ilegible cuenta como sin evidencia', async (t) => {
  const root = await project(t, { state: null });
  await writeFile(join(root, '.chalc', 'gate.state.json'), '{ roto');
  assert.equal((await approveFeature(root, { specDir: 'specs', ...TYPED })).reason, 'no-evidence');
});

test('R10: cada aprobación añade una línea al rastro, sin tocar las anteriores', async (t) => {
  const texts = ticked(coherentTexts(['R1']));
  const root = await project(t, { texts, sealed: false });
  await approveSpec(root, { specDir: 'specs', isTTY: true, ask: async () => '007-carrito', head: async () => 'abc1234def', now: () => new Date('2026-11-22T10:00:00.000Z') });
  await approveFeature(root, { specDir: 'specs', ...TYPED });
  const fingerprint = specFingerprint(texts);
  assert.deepEqual(await approvals(root), [
    { kind: 'spec', dir: DIR, fingerprint, head: 'abc1234def', date: '2026-11-22T10:00:00.000Z' },
    { kind: 'feature', dir: DIR, fingerprint, head: 'abc1234def', date: '2026-11-22T12:00:00.000Z' }
  ]);
});

test('R10: un rechazo no deja rastro de aprobación', async (t) => {
  const root = await project(t, { state: null });
  await approveFeature(root, { specDir: 'specs', ...TYPED });
  assert.deepEqual(await approvals(root), []);
});

test('R2: parseSeal de cierre exige evidencia fechada y un commit bien formado', () => {
  const ok = { dir: DIR, fingerprint: '0123456789abcdef', evidence: EVIDENCE, head: 'abc1234', date: EVIDENCE, approvedBy: 'user' };
  assert.deepEqual(parseSeal(JSON.stringify(ok), 'feature'), ok);
  assert.deepEqual(parseSeal(JSON.stringify({ ...ok, head: '' }), 'feature'), { ...ok, head: '' }, 'sin git no hay commit');
  for (const bad of [{ evidence: 'ayer' }, { evidence: undefined }, { head: 'no hex' }, { head: 7 }, { fingerprint: 'corta' }, { approvedBy: 'assistant' }, { dir: '' }]) {
    assert.equal(parseSeal(JSON.stringify({ ...ok, ...bad }), 'feature'), null, JSON.stringify(bad));
  }
});

test('R2: writeSeal de cierre solo guarda sus campos', async (t) => {
  const root = await tempDir(t, 'chalc-028-close-');
  await writeSeal(root, { dir: DIR, fingerprint: '0123456789abcdef', evidence: EVIDENCE, head: 'abc1234', date: EVIDENCE, hu: 'no va aquí' }, 'feature');
  assert.deepEqual(Object.keys(JSON.parse(await readFile(sealPath(root, DIR, 'feature'), 'utf8'))).sort(), ['approvedBy', 'date', 'dir', 'evidence', 'fingerprint', 'head']);
});

test('R2, R3: `gate.mjs --approve-feature` sella con 0, sin terminal sale con 2 y con otro rechazo, 1', async (t) => {
  const io = { isTTY: true, ask: async () => '007-carrito' };
  const run = async (root, withIo) => { const lines = []; return { code: await main({ argv: ['node', 'gate.mjs', '--approve-feature'], root, write: (l) => lines.push(l), io: withIo }), text: lines.join('\n') }; };
  const ready = await project(t);
  const done = await run(ready, io);
  assert.equal(done.code, 0);
  assert.ok(done.text.includes(DIR));
  assert.ok(existsSync(sealPath(ready, DIR, 'feature')));

  const noTty = await run(await project(t), { ...io, isTTY: false });
  assert.equal(noTty.code, 2);
  assert.ok(noTty.text.includes('node .chalc/gate.mjs --approve-feature'));

  const open = await run(await project(t, { texts: coherentTexts(['R1']) }), io);
  assert.equal(open.code, 1);
  assert.match(open.text, /tareas|tasks/);
});

test('R3: cada motivo de rechazo tiene su frase en es y en', () => {
  for (const lang of ['es', 'en']) {
    for (const key of ['prompt', 'done', 'noTerminal', 'noSpec', 'specNotApproved', 'tasksOpen', 'noEvidence', 'evidenceNotPass', 'evidenceFast', 'mismatch']) {
      assert.ok(FRAME[lang].approveFeature[key], `${lang}.${key}`);
    }
  }
});
