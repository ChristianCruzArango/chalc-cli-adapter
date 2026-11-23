// Spec 024 (coherencia), T5 — el portón bloquea antes de tests y mutación si la carpeta activa no es
// coherente o no está aprobada (R17), y solo el usuario, desde su terminal, puede sellarla (R14, R15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { coherentSpec, coherentTexts, sealFor } from './helpers/coherentspec.mjs';
import { main, runGate } from '../catalog/gate/gate.mjs';
import { specFacts } from '../catalog/gate/lib/specfacts.mjs';
import { approveSpec } from '../catalog/gate/lib/approve.mjs';
import { readSeal, sealPath } from '../catalog/gate/lib/specseal.mjs';
import { specFingerprint, huHash } from '../catalog/gate/lib/specprint.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { FRAME, MESSAGES } from '../catalog/gate/lib/i18n.mjs';

const DIR = 'specs/007-carrito';
const CONFIG = { stack: 'js', test: { command: 'npm test' }, mutation: { required: false }, spec: { dir: 'specs' }, role: 'back', language: 'es' };

async function project(t, files) {
  const root = await tempDir(t, 'chalc-024-gate-');
  const all = { '.chalc/gate.json': JSON.stringify(CONFIG), 'src/precio.ts': 'export const precio = () => 1;\n', ...files };
  for (const [rel, content] of Object.entries(all)) {
    const abs = join(root, ...rel.split('/'));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return root;
}
function runner() {
  const calls = [];
  const run = async (command) => { calls.push(command); return { code: 0, ms: 1 }; };
  run.calls = calls;
  return run;
}
const gate = (root, run = runner()) => runGate({ root, run, changed: ['src/precio.ts'], fast: true });
const stageNames = (result) => result.stages.map((s) => s.stage);
const TYPED = { isTTY: true, ask: async () => '007-carrito' };

test('specFacts junta carpeta, textos, huella, hash de la HU, sello y problemas', async (t) => {
  const texts = coherentTexts(['R1', 'R2']);
  const root = await project(t, coherentSpec(DIR, { texts }));
  const facts = await specFacts(root, 'specs');
  assert.equal(facts.dir, DIR);
  assert.equal(facts.fingerprint, specFingerprint(texts));
  assert.equal(facts.huHash, huHash(texts['hu.md']));
  assert.deepEqual(facts.seal, sealFor(DIR, texts));
  assert.deepEqual(facts.problems, []);
  assert.equal(facts.approved, true);
});

test('specFacts: sin sello, o con sello de otra huella, la spec no está aprobada', async (t) => {
  assert.equal((await specFacts(await project(t, coherentSpec(DIR, { sealed: false })), 'specs')).approved, false);
  const texts = coherentTexts();
  const stale = { ...coherentSpec(DIR, { texts }), [`${DIR}/plan.md`]: texts['plan.md'] + 'cambio posterior\n' };
  const facts = await specFacts(await project(t, stale), 'specs');
  assert.deepEqual(facts.problems, []);
  assert.equal(facts.approved, false);
});

test('R17: con la spec coherente y aprobada, la etapa coherence pasa primero y el portón sigue', async (t) => {
  const run = runner();
  const result = await gate(await project(t, coherentSpec(DIR)), run);
  assert.equal(stageNames(result)[0], 'coherence');
  assert.equal(result.stages[0].ok, true);
  assert.ok(stageNames(result).includes('tests'));
  assert.deepEqual(run.calls, ['npm test']);
});

test('R17: con problemas de coherencia el portón se bloquea y NO corre tests ni mutación', async (t) => {
  const files = coherentSpec(DIR);
  delete files[`${DIR}/plan.md`];
  const run = runner();
  const result = await gate(await project(t, files), run);
  assert.deepEqual(stageNames(result), ['coherence']);
  assert.equal(result.verdict, 'blocked');
  assert.equal(result.code, 1);
  assert.equal(result.closesTask, false);
  assert.deepEqual(run.calls, []);
  assert.ok(result.stages[0].findings.some((f) => f.rule === RULES.specFileMissing && f.data.name === 'plan.md'));
});

test('R17: coherente pero sin aprobación vigente también bloquea, diciendo cómo aprobar', async (t) => {
  const run = runner();
  const result = await gate(await project(t, coherentSpec(DIR, { sealed: false })), run);
  assert.deepEqual(stageNames(result), ['coherence']);
  assert.deepEqual(run.calls, []);
  assert.deepEqual(result.stages[0].findings.map((f) => f.rule), [RULES.specNotApproved]);
  assert.equal(result.stages[0].findings[0].file, DIR);
  for (const lang of ['es', 'en']) assert.ok(MESSAGES[lang][RULES.specNotApproved]({ dir: DIR }).includes('node .chalc/gate.mjs --approve-spec'), lang);
});

test('R17: un .chalc/active-spec inválido bloquea aunque haya otra carpeta buena', async (t) => {
  const result = await gate(await project(t, { ...coherentSpec(DIR), '.chalc/active-spec': '099-no-existe\n' }));
  assert.deepEqual(result.stages[0].findings.map((f) => f.rule), [RULES.activeSpecInvalid]);
});

test('R17: sin ninguna carpeta de spec no hay etapa coherence y el portón corre como siempre', async (t) => {
  const result = await gate(await project(t, {}));
  assert.equal(stageNames(result).includes('coherence'), false);
  assert.ok(stageNames(result).includes('tests'));
});

test('la etapa coherence tiene nombre en el marco en los dos idiomas', () => {
  assert.equal(typeof FRAME.es.stages.coherence, 'string');
  assert.equal(typeof FRAME.en.stages.coherence, 'string');
});

test('R14: approveSpec sella carpeta, hash de la HU, huella y fecha cuando el usuario teclea el nombre', async (t) => {
  const texts = coherentTexts();
  const root = await project(t, coherentSpec(DIR, { sealed: false, texts }));
  const out = await approveSpec(root, { specDir: 'specs', ...TYPED, now: () => new Date('2026-11-22T12:00:00.000Z') });
  assert.deepEqual(out, { ok: true, reason: '', dir: DIR, file: sealPath(root, DIR), problems: [] });
  assert.deepEqual(await readSeal(root, DIR), sealFor(DIR, texts, '2026-11-22T12:00:00.000Z'));
});

test('R14: con problemas mecánicos approveSpec se niega y no escribe nada', async (t) => {
  const files = coherentSpec(DIR, { sealed: false });
  delete files[`${DIR}/tasks.md`];
  const root = await project(t, files);
  const out = await approveSpec(root, { specDir: 'specs', ...TYPED });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'problems');
  assert.ok(out.problems.length > 0);
  assert.equal(existsSync(sealPath(root, DIR)), false);
});

test('R15: sin terminal interactiva approveSpec se niega sin preguntar ni sellar', async (t) => {
  const root = await project(t, coherentSpec(DIR, { sealed: false }));
  let asked = false;
  const out = await approveSpec(root, { specDir: 'specs', isTTY: false, ask: async () => { asked = true; return '007-carrito'; } });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-terminal');
  assert.equal(asked, false);
  assert.equal(existsSync(sealPath(root, DIR)), false);
});

test('R15: si el nombre tecleado no coincide con la carpeta, no se sella', async (t) => {
  const root = await project(t, coherentSpec(DIR, { sealed: false }));
  for (const typed of ['', 'si', '007-carrit', 'specs/007-carrito ', '008-otra']) {
    const out = await approveSpec(root, { specDir: 'specs', isTTY: true, ask: async () => typed });
    assert.equal(out.reason, 'name-mismatch', JSON.stringify(typed));
  }
  assert.equal(existsSync(sealPath(root, DIR)), false);
  assert.equal((await approveSpec(root, { specDir: 'specs', isTTY: true, ask: async () => '  007-carrito\n' })).ok, true);
});

test('R8: una HU cambiada tras el sello no impide que el usuario la apruebe de nuevo', async (t) => {
  const texts = coherentTexts();
  const files = coherentSpec(DIR, { texts });
  files[`${DIR}/hu.md`] = texts['hu.md'].replace('# HU: demo', '# HU: demo corregida');
  const root = await project(t, files);
  assert.ok((await specFacts(root, 'specs')).problems.some((p) => p.rule === RULES.huChanged));
  const out = await approveSpec(root, { specDir: 'specs', ...TYPED });
  assert.equal(out.ok, true);
  assert.deepEqual((await specFacts(root, 'specs')).problems, []);
});

test('approveSpec sin carpeta activa se niega', async (t) => {
  const out = await approveSpec(await project(t, {}), { specDir: 'specs', ...TYPED });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-spec');
});

test('R15: `gate.mjs --approve-spec` sin terminal sale con 2 y muestra el comando para el usuario', async (t) => {
  const root = await project(t, coherentSpec(DIR, { sealed: false }));
  const lines = [];
  const code = await main({ argv: ['node', 'gate.mjs', '--approve-spec'], root, write: (l) => lines.push(l), io: { isTTY: false, ask: async () => '007-carrito' } });
  assert.equal(code, 2);
  assert.ok(lines.join('\n').includes('node .chalc/gate.mjs --approve-spec'));
  assert.equal(existsSync(sealPath(root, DIR)), false);
});

test('R14: `gate.mjs --approve-spec` con terminal y nombre correcto sella y sale con 0', async (t) => {
  const root = await project(t, coherentSpec(DIR, { sealed: false }));
  const lines = [];
  const asked = [];
  const io = { isTTY: true, ask: async (prompt) => { asked.push(prompt); return '007-carrito'; } };
  assert.equal(await main({ argv: ['node', 'gate.mjs', '--approve-spec'], root, write: (l) => lines.push(l), io }), 0);
  assert.ok(asked[0].includes('007-carrito'), 'la pregunta nombra la carpeta que hay que teclear');
  assert.ok(existsSync(sealPath(root, DIR)));
  assert.ok(lines.join('\n').includes(DIR));
});

test('R14: `gate.mjs --approve-spec` con problemas los lista y sale con 1', async (t) => {
  const files = coherentSpec(DIR, { sealed: false });
  delete files[`${DIR}/plan.md`];
  const root = await project(t, files);
  const lines = [];
  const code = await main({ argv: ['node', 'gate.mjs', '--approve-spec'], root, write: (l) => lines.push(l), io: TYPED });
  assert.equal(code, 1);
  assert.ok(lines.join('\n').includes(`${DIR}/plan.md`));
});
