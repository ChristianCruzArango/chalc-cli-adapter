// Tests del modo REVIEW (F2 del orquestador multi-rol): recolectar cambios (git diff o contenido de
// archivos nuevos), veredicto OK vs hallazgos, y el flujo por sesión. Sin red: chatImpl guionizado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from '../lib/i18n.mjs';
import { collectChanges, runReviewer, touchedPaths } from '../cli/engine/review.mjs';
import { savePlan, markStepDone } from '../cli/engine/planfile.mjs';
import { createSession } from '../cli/session.mjs';

async function makeProject(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-cli-review-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

test('touchedPaths extrae solo rutas escritas/editadas con éxito', () => {
  const result = { steps: [
    { action: { tool: 'read', args: { path: 'a.js' } }, observation: { path: 'a.js', content: 'x' } },
    { action: { tool: 'write', args: {} }, observation: { path: 'nuevo.md', ok: true } },
    { action: { tool: 'edit', args: {} }, observation: { path: 'b.js', ok: true } },
    { action: { tool: 'write', args: {} }, observation: { path: 'fallo.md', error: 'no aprobada' } },
    { action: { tool: 'write', args: {} }, observation: { path: 'nuevo.md', ok: true } }   // duplicado
  ] };
  assert.deepEqual(touchedPaths(result), ['nuevo.md', 'b.js']);
  assert.deepEqual(touchedPaths(null), []);
});

test('collectChanges sin repo git usa el contenido de los archivos; vacío sin rutas', async () => {
  const dir = await makeProject({ 'src/a.js': 'const x = 1;\n' });
  try {
    assert.equal(await collectChanges(dir, []), '');
    const material = await collectChanges(dir, ['src/a.js', 'no-existe.js']);
    assert.match(material, /=== src\/a\.js \(archivo completo\) ===/);
    assert.match(material, /const x = 1;/);
    assert.doesNotMatch(material, /no-existe/);   // ilegible: se omite sin fallar
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runReviewer: "OK" aprueba; una lista es hallazgos; sin cambios → empty', async () => {
  const ok = await runReviewer({ chatImpl: async () => '{"done":true,"summary":"OK"}', tools: {}, task: 't', changes: 'diff x' });
  assert.equal(ok.ok, true);
  assert.equal(ok.findings, '');

  const bad = await runReviewer({ chatImpl: async () => '{"done":true,"summary":"1. a.js: import roto"}', tools: {}, task: 't', changes: 'diff x' });
  assert.equal(bad.ok, false);
  assert.match(bad.findings, /import roto/);

  const empty = await runReviewer({ chatImpl: async () => { throw new Error('no debe llamarse'); }, tools: {}, task: 't', changes: '' });
  assert.equal(empty.empty, true);
  assert.equal(empty.ok, true);
});

test('runReviewer sin veredicto (error del modelo) no aprueba ni inventa hallazgos', async () => {
  const r = await runReviewer({ chatImpl: async () => 'basura', tools: {}, task: 't', changes: 'diff', maxSteps: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.findings, '');
  assert.ok(r.error.startsWith(t('cliLoopNoValidTurn', 3, '')));   // idioma-independiente (es/en)
});

test('flujo por sesión: coder escribe → review ve los cambios con rol revisor y SOLO lectura', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    const systems = [];
    const turns = [
      '{"action":{"tool":"write","args":{"path":"hola.md","content":"# Hola\\n"}}}',
      '{"done":true,"summary":"creado"}',
      '{"done":true,"summary":"1. hola.md: falta el saludo en inglés"}'   // veredicto del reviewer
    ];
    let i = 0;
    const chatImpl = async ({ system }) => { systems.push(system); return turns[Math.min(i++, turns.length - 1)]; };
    const session = await createSession({ projectPath: dir, chatImpl, language: 'es' });

    const result = await session.ask('crea hola.md');
    const paths = touchedPaths(result);
    assert.deepEqual(paths, ['hola.md']);

    const review = await session.review('crea hola.md', { paths });
    assert.equal(review.ok, false);
    assert.match(review.findings, /saludo en inglés/);
    const reviewerSystem = systems[systems.length - 1];
    assert.match(reviewerSystem, /REVIEWER/);
    assert.match(reviewerSystem, /changes to review/);
    assert.match(reviewerSystem, /# Hola/);            // el contenido nuevo viajó como material a revisar
    assert.doesNotMatch(reviewerSystem, /- write:/);   // el reviewer NO tiene tools de escritura
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('el revisor recibe el CONTRATO: spec aprobado + plan de ejecución (con [x] del harness) + skills', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    // el líder dejó plan + spec persistidos (savePlan real) y el harness marcó la tarea 1
    savePlan(dir, 'crear hola', '1. Crear hola.md\n2. Traducirlo', { leader: 'opus', spec: '## Task 1\nCONTRATO-R1: hola.md con saludo\n## Task 2\nCONTRATO-R2: saludo en inglés' });
    markStepDone(dir, 0);
    const systems = [];
    const turns = [
      '{"action":{"tool":"write","args":{"path":"hola.md","content":"# Hola\\n"}}}',
      '{"done":true,"summary":"creado"}',
      '{"done":true,"summary":"OK"}'
    ];
    let i = 0;
    const session = await createSession({ projectPath: dir, chatImpl: async ({ system }) => { systems.push(system); return turns[Math.min(i++, turns.length - 1)]; }, language: 'es' });
    const result = await session.ask('crea hola.md');
    await session.review('crear hola', { paths: touchedPaths(result) });
    await session.close();
    const sys = systems[systems.length - 1];
    assert.match(sys, /approved spec \(the CONTRACT/);        // el spec viaja como contrato obligatorio
    assert.match(sys, /CONTRATO-R1/);
    assert.match(sys, /execution plan \(what was ordered/);   // y el plan de ejecución con su estado real
    assert.match(sys, /- \[x\] 1\. Crear hola\.md/);          // la [x] que marcó el harness es visible
    assert.match(sys, /- \[ \] 2\. Traducirlo/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---- reviewfile: bitácora persistida del ciclo revisor→junior→verificación (.chalc/review.md) ----
import { startReview, logRound, logFixOrder, logFixResult, logVerify, loadReview, reviewPath } from '../cli/engine/reviewfile.mjs';
import { mkdtemp as mkdtemp2 } from 'node:fs/promises';
import { tmpdir as tmpdir2 } from 'node:os';
import { join as join2 } from 'node:path';
import { rm as rm2 } from 'node:fs/promises';

test('review.md registra el ciclo completo: veredicto, orden literal, resultado y verificación', async () => {
  const dir = await mkdtemp2(join2(tmpdir2(), 'chalc-reviewfile-'));
  try {
    startReview(dir, 'listar empleados', { reviewer: 'openai/gpt-5.5 (openrouter)' });
    logRound(dir, 1, { ok: false, findings: '1. la ruta importa employee-list.component pero el archivo es employee-list.ts' });
    logFixOrder(dir, 'Fix ONLY these review findings on the recently modified files (change nothing else):\n1. la ruta…');
    logFixResult(dir, { done: true, summary: 'imports corregidos' });
    logVerify(dir, 1, { ok: false, command: 'npx ng build', output: 'error TS2307: Cannot find module' });
    logVerify(dir, 2, { ok: true, command: 'npx ng build' });
    const text = loadReview(dir);
    assert.match(text, /> Revisor: openai\/gpt-5\.5 \(openrouter\)/);
    assert.match(text, /## Ronda 1 — HALLAZGOS/);
    assert.match(text, /employee-list\.component/);
    assert.match(text, /### Orden de corrección al junior/);
    assert.match(text, /Fix ONLY these review findings/);          // la orden LITERAL, no una paráfrasis
    assert.match(text, /✔ imports corregidos/);
    assert.match(text, /## Verificación ronda 1 — FALLÓ \(`npx ng build`\)/);
    assert.match(text, /TS2307/);                                  // la cola del error del compilador queda en la bitácora
    assert.match(text, /## Verificación ronda 2 — OK ✔/);
  } finally { await rm2(dir, { recursive: true, force: true }); }
});

test('reviewfile es inofensivo sin bitácora abierta o sin projectPath (no crea nada solo)', async () => {
  const dir = await mkdtemp2(join2(tmpdir2(), 'chalc-reviewfile-'));
  try {
    assert.equal(logRound(dir, 1, { ok: true }), false);           // sin startReview: no-op
    assert.equal(loadReview(dir), null);
    assert.equal(startReview(undefined, 'x'), null);
    assert.equal(logVerify(undefined, 1, { ok: true, command: 'x' }), false);
  } finally { await rm2(dir, { recursive: true, force: true }); }
});
