// Spec 028 (puertas humanas), T2 — el cierre lo aprueba el usuario (R1, R4, R5, R7, R8): con todo hecho, medido y
// revisado, el advisor responde `approve_feature` hasta que exista su sello para ESA spec y ESA evidencia. Y la
// aprobación por tarea desaparece, diga lo que diga un `gate.json` antiguo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { coherentSpec, coherentTexts } from './helpers/coherentspec.mjs';
import { READY_SPECS, READY_FINGERPRINT } from './helpers/readyspecs.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';
import { ACTIONS, commandOf } from '../catalog/next/lib/actions.mjs';
import { FRAME, reasonOf } from '../catalog/next/lib/i18n.mjs';
import { snapshot } from '../catalog/next/lib/snapshot.mjs';
import { specFingerprint } from '../catalog/gate/lib/specprint.mjs';
import { writeSeal } from '../catalog/gate/lib/specseal.mjs';

const GATE = Date.parse('2026-11-22T11:00:00.000Z');
const REVIEWED = GATE + 60000;
const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }, { id: 'endurecedor', order: 20, cadence: 'feature', required: true }];
const OK = (role, date = REVIEWED) => ({ role, date, commit: 'abc1234', ok: true, findings: 0 });

// Todo hecho: tareas marcadas, evidencia vigente que aprueba y el rol de feature con su OK.
const snap = (over = {}) => ({
  specs: READY_SPECS,
  tdd: { red: true },
  closing: over.closing ?? null,
  tasks: { hasTasksFile: true, done: 2, total: 2, current: '', mtime: GATE + 1, ...over.tasks },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, scopeHash: 'h', currentScopeHash: 'h', branch: 'main', head: 'abc1234', pending: [], ...over.gate },
  review: { entries: over.entries ?? [OK('endurecedor')] },
  changed: { files: ['src/a.ts'], newestMtime: GATE - 1000 },
  flow: { review: { required: true }, roles: ROLES, ...over.flow },
  git: { isRepo: true, branch: 'main', head: 'abc1234' },
  now: REVIEWED + 1000
});
const SEALED = { fingerprint: READY_FINGERPRINT, evidence: GATE };

test('R1: con todo hecho y sin la aprobación del usuario → approve_feature, con la carpeta y la huella', () => {
  const out = decide(snap());
  assert.equal(out.action, 'approve_feature');
  assert.deepEqual(out.facts, { dir: READY_SPECS.dir, fingerprint: READY_FINGERPRINT, total: 2 });
});

test('R4: con el cierre sellado para esta spec y esta evidencia → done', () => {
  assert.equal(decide(snap({ closing: SEALED })).action, 'done');
});

test('R5: un sello de otra huella o de otra evidencia no vale', () => {
  assert.equal(decide(snap({ closing: { ...SEALED, fingerprint: '0'.repeat(16) } })).action, 'approve_feature');
  assert.equal(decide(snap({ closing: { ...SEALED, evidence: GATE - 1 } })).action, 'approve_feature');
  assert.equal(decide(snap({ closing: { ...SEALED, evidence: GATE + 1 } })).action, 'approve_feature');
});

test('R1: approve_feature va después de los roles de feature y antes de done', () => {
  assert.equal(decide(snap({ entries: [] })).action, 'call_role', 'primero el rol de feature');
  assert.equal(decide(snap({ entries: [{ ...OK('endurecedor'), ok: false, findings: 1 }] })).action, 'fix_review');
  assert.equal(decide(snap({ tasks: { done: 1, current: '**T2** (R1) — b', mtime: GATE + 1 }, entries: [OK('revisor'), OK('endurecedor')] })).action, 'work_task', 'con tareas pendientes no se cierra');
});

test('R7: ningún interruptor salta la aprobación del cierre', () => {
  assert.equal(decide(snap({ flow: { approvals: { task: false, feature: false }, review: { required: false }, roles: ROLES } })).action, 'approve_feature');
});

test('R8: tick_task ya no pide aprobación por tarea, diga lo que diga flow.approvals', () => {
  const ticking = snap({ tasks: { done: 0, current: '**T1** (R1) — a', mtime: GATE - 5000 }, entries: [OK('revisor')], flow: { approvals: { task: true, feature: true }, roles: ROLES } });
  const out = decide(ticking);
  assert.equal(out.action, 'tick_task');
  assert.equal('waitForApproval' in out.facts, false);
  for (const lang of ['es', 'en']) {
    const reason = reasonOf('tick_task', { ...out.facts, waitForApproval: true }, lang);
    assert.doesNotMatch(reason, /PARA|STOP/, lang);
  }
});

test('el vocabulario incluye approve_feature, justo antes de done, con el comando del usuario', () => {
  assert.equal(ACTIONS.indexOf('approve_feature'), ACTIONS.indexOf('done') - 1);
  assert.equal(commandOf('approve_feature'), 'node .chalc/gate.mjs --approve-feature');
  assert.equal(commandOf('approve_feature', { gatePath: '../back/.chalc/gate.mjs' }), 'node ../back/.chalc/gate.mjs --approve-feature');
});

test('R1: el motivo dice en es y en que PARA y que solo el usuario aprueba el cierre', () => {
  const facts = { dir: 'specs/001-demo', fingerprint: READY_FINGERPRINT, total: 2 };
  for (const lang of ['es', 'en']) assert.equal(typeof FRAME[lang].reason.approve_feature, 'function', lang);
  const es = reasonOf('approve_feature', facts, 'es');
  assert.match(es, /PARA/);
  assert.match(es, /usuario/);
  assert.match(es, /specs\/001-demo/);
  const en = reasonOf('approve_feature', facts, 'en');
  assert.match(en, /STOP/);
  assert.match(en, /user/);
});

// ── con el repo de verdad ─────────────────────────────────────────────────────────────────────────

async function repo(t) {
  const root = await tempDir(t, 'chalc-028-next-');
  const texts = coherentTexts(['R1']);
  const files = { '.chalc/gate.json': JSON.stringify({ spec: { dir: 'specs' }, language: 'es' }), ...coherentSpec('specs/001-demo', { texts }) };
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return { root, texts };
}
const read = (root) => snapshot(root, { changed: async () => [], branch: async () => 'main', head: async () => 'abc1234' });

test('R4: el snapshot trae el sello de cierre de la carpeta activa, con la evidencia como fecha', async (t) => {
  const { root, texts } = await repo(t);
  assert.equal((await read(root)).closing, null);
  await writeSeal(root, { dir: 'specs/001-demo', fingerprint: specFingerprint(texts), evidence: '2026-11-22T11:00:00.000Z', head: 'abc1234', date: '2026-11-22T12:00:00.000Z' }, 'feature');
  assert.deepEqual((await read(root)).closing, { fingerprint: specFingerprint(texts), evidence: GATE });
});

test('R8: el snapshot ya no expone flow.approvals', async (t) => {
  const { root } = await repo(t);
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ spec: { dir: 'specs' }, flow: { approvals: { task: false, feature: false } } }));
  assert.equal('approvals' in (await read(root)).flow, false);
});
