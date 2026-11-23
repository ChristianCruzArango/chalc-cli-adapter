// Spec 024 (coherencia), T7 — el advisor bloquea antes de tests y código (R9–R12, R16): `fix_specs` mientras
// haya problemas, luego el rol de cadencia `spec` atado a la huella, y por último `approve_spec`, que solo
// puede dar el usuario. Nada de eso tiene interruptor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { coherentSpec, coherentTexts, sealFor } from './helpers/coherentspec.mjs';
import { READY_SPECS, READY_FINGERPRINT } from './helpers/readyspecs.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';
import { ACTIONS, commandOf } from '../catalog/next/lib/actions.mjs';
import { FRAME, reasonOf } from '../catalog/next/lib/i18n.mjs';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { snapshot } from '../catalog/next/lib/snapshot.mjs';
import { advise } from '../catalog/next/next.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { specFingerprint } from '../catalog/gate/lib/specprint.mjs';

const T0 = Date.parse('2026-11-22T10:00:00Z');
const ANALISTA = { id: 'analista', order: 1, cadence: 'spec', required: true };
const ESPECIFICADOR = { id: 'especificador', order: 0, cadence: 'spec', kind: 'author', required: true };
const REVISOR = { id: 'revisor', order: 10, cadence: 'task', required: true };
const PROBLEM = { file: 'specs/001-demo/plan.md', line: 3, rule: RULES.planUnknownRequirement, data: { id: 'R9' } };
const analystEntry = (over = {}) => ({ role: 'analista', date: T0, commit: 'abc1234', ok: true, findings: 0, fingerprint: READY_FINGERPRINT, ...over });

// Una tarea pendiente sin nada cambiado: con la spec lista, toca trabajarla.
const snap = (over = {}) => ({
  specs: { ...READY_SPECS, approved: false, ...over.specs },
  tdd: { red: true },
  tasks: { hasTasksFile: true, done: 0, total: 2, current: '**T1** (R1) — test', mtime: 0 },
  gate: { exists: false, pending: [], ...over.gate },
  review: { entries: over.entries || [] },
  changed: { files: [], newestMtime: 0 },
  flow: { approvals: { task: true, feature: true }, review: { required: true }, roles: over.roles || [ESPECIFICADOR, ANALISTA, REVISOR] },
  git: { isRepo: true, branch: 'main', head: 'abc1234' },
  now: T0 + 1000
});
const act = (over) => decide(snap(over));

test('R9: con problemas de coherencia responde fix_specs con la lista exacta', () => {
  const out = act({ specs: { problems: [PROBLEM] } });
  assert.equal(out.action, 'fix_specs');
  assert.deepEqual(out.facts.problems, [PROBLEM]);
  assert.equal(out.facts.dir, 'specs/001-demo');
  assert.equal(out.facts.author, 'especificador');
});

test('R9: fix_specs va después de blocked_config y antes de cualquier acción de tests o código', () => {
  assert.equal(act({ specs: { problems: [PROBLEM] }, gate: { pending: ['test.command'] } }).action, 'blocked_config');
  const withWork = snap({ specs: { problems: [PROBLEM] } });
  withWork.changed = { files: ['src/a.ts'], newestMtime: T0 };
  assert.equal(decide(withWork).action, 'fix_specs', 'no manda a correr el portón');
});

test('R9: sin carpeta de spec responde fix_specs (crearla), no ask_human', () => {
  const out = act({ specs: { dir: null, problem: 'no-spec', problems: [] } });
  assert.equal(out.action, 'fix_specs');
  assert.equal(out.facts.noSpec, true);
});

test('R9, R25: un active-spec inválido es fix_specs con su problema, no «no hay spec»', () => {
  const invalid = { file: '.chalc/active-spec', line: 1, rule: RULES.activeSpecInvalid, data: {} };
  const out = act({ specs: { dir: null, problem: 'active-spec-invalid', problems: [invalid] } });
  assert.equal(out.action, 'fix_specs');
  assert.equal(out.facts.noSpec, false);
  assert.deepEqual(out.facts.problems, [invalid]);
});

test('R10: sin problemas y sin entrada del analista para la huella actual → call_role analista', () => {
  const out = act();
  assert.equal(out.action, 'call_role');
  assert.deepEqual({ role: out.facts.role, cadence: out.facts.cadence, fingerprint: out.facts.fingerprint, dir: out.facts.dir },
    { role: 'analista', cadence: 'spec', fingerprint: READY_FINGERPRINT, dir: 'specs/001-demo' });
});

test('R10: una entrada del analista con OTRA huella (o sin huella) no cuenta', () => {
  assert.equal(act({ entries: [analystEntry({ fingerprint: '0'.repeat(16) })] }).action, 'call_role');
  assert.equal(act({ entries: [analystEntry({ fingerprint: undefined })] }).action, 'call_role');
  assert.equal(act({ entries: [{ ...analystEntry(), role: 'revisor' }] }).action, 'call_role');
});

test('R10: con hallazgos del analista para la huella actual → fix_review', () => {
  const out = act({ entries: [analystEntry({ ok: false, findings: 2 })] });
  assert.equal(out.action, 'fix_review');
  assert.equal(out.facts.role, 'analista');
  assert.equal(out.facts.findings, 2);
});

test('R10: el especificador (autor) no deja entrada ni se le pide: no es un revisor', () => {
  assert.equal(act({ roles: [ESPECIFICADOR, REVISOR] }).action, 'approve_spec');
});

test('R11: analista OK y sin aprobación del usuario → approve_spec, con la carpeta y la huella', () => {
  const out = act({ entries: [analystEntry()] });
  assert.equal(out.action, 'approve_spec');
  assert.deepEqual(out.facts, { dir: 'specs/001-demo', fingerprint: READY_FINGERPRINT });
});

test('R11: una aprobación ANTERIOR a la entrada OK del analista no vale: el usuario aprueba lo validado', () => {
  const entries = [analystEntry({ date: T0 })];
  assert.equal(act({ entries, specs: { approved: true, sealDate: T0 - 5000 } }).action, 'approve_spec');
  assert.equal(act({ entries, specs: { approved: true, sealDate: T0 + 400 } }).action, 'work_task', 'mismo segundo: vale');
  assert.equal(act({ entries, specs: { approved: true, sealDate: T0 + 5000 } }).action, 'work_task');
});

test('R11: aprobada y validada, el ciclo de tarea sigue como siempre', () => {
  assert.equal(act({ entries: [analystEntry()], specs: { approved: true, sealDate: T0 + 1000 } }).action, 'work_task');
});

test('R11: sin rol de cadencia spec en gate.json (repo anterior) solo se exige la aprobación', () => {
  assert.equal(act({ roles: [REVISOR] }).action, 'approve_spec');
  assert.equal(act({ roles: [REVISOR], specs: { approved: true, sealDate: T0 } }).action, 'work_task');
});

test('R9: una corrida del portón que se quedó en la etapa coherence no es evidencia del código', () => {
  // Quien corre el portón antes de que la spec esté aprobada deja un estado «bloqueado». Aprobada la spec, ese
  // estado no dice nada del código: no hay que «arreglar el portón», hay que trabajar la tarea.
  const stale = { exists: true, date: T0, verdict: 'blocked', fast: true, failedStages: ['coherence'], scopeHash: '', currentScopeHash: '', pending: [] };
  const ready = { entries: [analystEntry()], specs: { approved: true, sealDate: T0 + 1000 } };
  assert.equal(act({ ...ready, gate: stale }).action, 'work_task');
  const withWork = snap({ ...ready, gate: stale });
  withWork.changed = { files: ['src/a.ts'], newestMtime: T0 - 5000 };
  assert.equal(decide(withWork).action, 'run_gate', 'con código cambiado, se mide: esa evidencia no vale');
  assert.equal(act({ ...ready, gate: { ...stale, failedStages: ['coherence', 'tests'] } }).action, 'fix_gate');
  assert.equal(act({ ...ready, gate: { ...stale, failedStages: ['tests'] } }).action, 'fix_gate');
});

test('R12: ningún interruptor de flow salta la aprobación de la spec', () => {
  const s = snap({ entries: [analystEntry()] });
  s.flow.approvals = { task: false, feature: false, spec: false };
  s.flow.review = { required: false };
  assert.equal(decide(s).action, 'approve_spec');
});

test('un snapshot sin hechos de la spec no se da por bueno: ask_human', () => {
  const s = snap();
  delete s.specs;
  const out = decide(s);
  assert.equal(out.action, 'ask_human');
  assert.ok(out.facts.problems.includes('specs-unread'));
});

test('R9: tasks.md ausente o vacío ya no es ask_human: lo reporta fix_specs', () => {
  const missing = { file: 'specs/001-demo/tasks.md', line: 1, rule: RULES.specFileMissing, data: { name: 'tasks.md' } };
  const s = snap({ specs: { problems: [missing] } });
  s.tasks = { hasTasksFile: false, done: 0, total: 0, current: '', mtime: 0 };
  assert.equal(decide(s).action, 'fix_specs');
});

test('el vocabulario incluye fix_specs y approve_spec; approve_spec lleva el comando del usuario', () => {
  assert.ok(ACTIONS.indexOf('fix_specs') === ACTIONS.indexOf('blocked_config') + 1);
  assert.ok(ACTIONS.includes('approve_spec'));
  assert.equal(commandOf('approve_spec'), 'node .chalc/gate.mjs --approve-spec');
  assert.equal(commandOf('approve_spec', { gatePath: '../back/.chalc/gate.mjs' }), 'node ../back/.chalc/gate.mjs --approve-spec');
  assert.equal(commandOf('fix_specs'), '');
});

test('R9, R16: los motivos existen en es y en, citan el problema y dicen que solo el usuario aprueba', () => {
  for (const lang of ['es', 'en']) {
    for (const action of ['fix_specs', 'approve_spec']) assert.equal(typeof FRAME[lang].reason[action], 'function', `${action} ${lang}`);
    const fix = reasonOf('fix_specs', { dir: 'specs/001-demo', problems: [PROBLEM], noSpec: false, author: 'especificador' }, lang);
    assert.ok(fix.includes('specs/001-demo/plan.md:3') && fix.includes('R9') && fix.includes('especificador'), fix);
    const none = reasonOf('fix_specs', { dir: '', problems: [], noSpec: true, author: '' }, lang);
    assert.ok(none.includes('hu.md'), none);
    const role = reasonOf('call_role', { role: 'analista', cadence: 'spec', fingerprint: READY_FINGERPRINT, dir: 'specs/001-demo' }, lang);
    assert.ok(role.includes('analista') && role.includes(READY_FINGERPRINT), role);
  }
  const es = reasonOf('approve_spec', { dir: 'specs/001-demo', fingerprint: READY_FINGERPRINT }, 'es');
  assert.match(es, /PARA/);
  assert.match(es, /usuario/);
  assert.match(es, /tests ni código/);
  const en = reasonOf('approve_spec', { dir: 'specs/001-demo', fingerprint: READY_FINGERPRINT }, 'en');
  assert.match(en, /STOP/);
  assert.match(en, /user/);
});

test('R10: la bitácora lee la línea de huella en español y en inglés', () => {
  const log = [
    '## 2026-11-22T10:00:00Z · abc1234 · analista · OK', '- Huella: 0123456789abcdef', '',
    '## 2026-11-22T10:05:00Z · abc1234 · analista · FINDINGS: 1', '1. specs/001-demo/spec.md:3 — R2 no sale de la HU', '- Fingerprint: fedcba9876543210', '',
    '## 2026-11-22T10:06:00Z · abc1234 · revisor · OK', '- Huella: no-es-hex'
  ].join('\n');
  assert.deepEqual(allReviews(log).map((e) => e.fingerprint), ['0123456789abcdef', 'fedcba9876543210', '']);
});

// ── con el repo de verdad ─────────────────────────────────────────────────────────────────────────

const CONFIG = { stack: 'js', test: { command: 'npm test' }, mutation: { required: false }, spec: { dir: 'specs' }, language: 'es', flow: { roles: [ESPECIFICADOR, ANALISTA, REVISOR] } };
async function repo(t, files) {
  const root = await tempDir(t, 'chalc-024-next-');
  for (const [rel, content] of Object.entries({ '.chalc/gate.json': JSON.stringify(CONFIG), ...files })) {
    const abs = join(root, ...rel.split('/'));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return root;
}
const read = (root) => snapshot(root, { changed: async () => [], branch: async () => 'main', head: async () => 'abc1234' });

test('R1: el snapshot trae los hechos de la carpeta activa y las tareas SOLO de ella', async (t) => {
  const texts = coherentTexts(['R1']);
  const root = await repo(t, { ...coherentSpec('specs/001-vieja', { ids: ['R1', 'R2'] }), ...coherentSpec('specs/002-nueva', { texts }) });
  const s = await read(root);
  assert.equal(s.specs.dir, 'specs/002-nueva');
  assert.equal(s.specs.fingerprint, specFingerprint(texts));
  assert.equal(s.specs.approved, true);
  assert.equal(s.specs.sealDate, Date.parse(sealFor('specs/002-nueva', texts).date));
  assert.deepEqual(s.specs.problems, []);
  assert.equal(s.tasks.total, 1, 'las tareas son las de la carpeta activa, no las dos de la anterior');
});

test('R2: una spec nueva sin tasks.md no reutiliza las tareas de la anterior', async (t) => {
  const files = { ...coherentSpec('specs/001-vieja'), ...coherentSpec('specs/002-nueva', { sealed: false }) };
  delete files['specs/002-nueva/tasks.md'];
  const s = await read(await repo(t, files));
  assert.equal(s.tasks.hasTasksFile, false);
  assert.ok(s.specs.problems.some((p) => p.rule === RULES.specFileMissing && p.data.name === 'tasks.md'));
  assert.equal(decide(s).action, 'fix_specs');
});

test('de punta a punta: fix_specs → analista → approve_spec con el comando → trabajo', async (t) => {
  const texts = coherentTexts(['R1']);
  const broken = coherentSpec('specs/001-demo', { sealed: false, texts });
  delete broken['specs/001-demo/plan.md'];
  const root = await repo(t, broken);
  const opts = { root, read };
  assert.equal((await advise(opts)).action, 'fix_specs');

  await writeFile(join(root, 'specs', '001-demo', 'plan.md'), texts['plan.md']);
  const call = await advise(opts);
  assert.equal(call.action, 'call_role');
  assert.ok(call.reason.includes(specFingerprint(texts)));

  const stamp = new Date(Date.now() - 2000).toISOString().replace(/\.\d+Z$/, 'Z');
  await writeFile(join(root, '.chalc', 'review.md'), `## ${stamp} · abc1234 · analista · OK\n- Huella: ${specFingerprint(texts)}\n`);
  const approve = await advise(opts);
  assert.equal(approve.action, 'approve_spec');
  assert.equal(approve.command, 'node .chalc/gate.mjs --approve-spec');
  assert.equal(approve.code, 0);

  await mkdir(join(root, '.chalc', 'seals'), { recursive: true });
  await writeFile(join(root, '.chalc', 'seals', '001-demo.spec.json'), JSON.stringify(sealFor('specs/001-demo', texts, new Date().toISOString())));
  assert.equal((await advise(opts)).action, 'work_task');

  await writeFile(join(root, 'specs', '001-demo', 'spec.md'), texts['spec.md'] + '\nun cambio posterior\n');
  assert.equal((await advise(opts)).action, 'call_role', 'editar la spec invalida al analista y la aprobación');
});
