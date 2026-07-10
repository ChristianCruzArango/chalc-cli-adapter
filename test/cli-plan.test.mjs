// Tests del modo PLAN (F1 del orquestador multi-rol): planner en solo lectura → plan numerado →
// el plan aprobado viaja al harness del coder. Todo con chatImpl guionizado, sin red ni tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from '../lib/i18n.mjs';
import { readOnlyTools, runPlanner, planSection, formatPlan, isNumberedPlan, planItems, stepTask, stepNeedsMutation, stepRetryTask, stepIsSpecWork, splitPlanSpec, specSectionFor } from '../cli/engine/plan.mjs';
import { createSession } from '../cli/session.mjs';

async function makeProject(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-cli-plan-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

test('readOnlyTools filtra write/edit/bash y las tools MCP', () => {
  const all = { read: {}, list: {}, grep: {}, describe: {}, write: {}, edit: {}, bash: {}, 'mcp__pg__query': {} };
  assert.deepEqual(Object.keys(readOnlyTools(all)).sort(), ['describe', 'grep', 'list', 'read']);
});

test('runPlanner explora en solo lectura y entrega el plan; write NO existe para él', async () => {
  const reads = [];
  const tools = {
    read: { summary: 'lee', run: async (a) => { reads.push(a.path); return { content: 'x' }; } },
    write: { summary: 'escribe', run: async () => { throw new Error('el planner jamás debe llegar aquí'); } }
  };
  const turns = [
    '{"thought":"ver","action":{"tool":"read","args":{"path":"a.js"}}}',
    '{"thought":"intento prohibido","action":{"tool":"write","args":{"path":"b.js","content":"x"}}}',
    '{"done":true,"summary":"1. Editar a.js\\n2. Correr tests"}'
  ];
  let i = 0;
  const r = await runPlanner({
    chatImpl: async () => turns[Math.min(i++, turns.length - 1)],
    tools, task: 'mejorar a.js', language: 'es'
  });
  assert.equal(r.plan, '1. Editar a.js\n2. Correr tests');
  assert.deepEqual(reads, ['a.js']);
  // el write pedido en el paso 2 se respondió como herramienta desconocida (filtrada), sin ejecutarse
  assert.match(r.steps[1].observation.error, /unknown tool: write/);
});

test('runPlanner reporta error/interrupción con plan vacío (nunca un plan a medias)', async () => {
  const r = await runPlanner({ chatImpl: async () => 'basura no json', tools: {}, task: 'x', maxSteps: 2 });
  assert.equal(r.plan, '');
  assert.ok(r.error.startsWith(t('cliLoopNoValidTurn', 3, '')));   // idioma-independiente (es/en)
});

test('formatPlan separa en líneas un plan que vino pegado en una sola', () => {
  const glued = "1. Crear la carpeta 'profile'. 2. Crear el módulo de rutas. 3. Crear el componente.";
  assert.equal(formatPlan(glued), "1. Crear la carpeta 'profile'.\n2. Crear el módulo de rutas.\n3. Crear el componente.");
  // idempotente con planes ya multilínea
  const multi = '1. a\n2. b';
  assert.equal(formatPlan(multi), multi);
  assert.equal(formatPlan(''), '');
});

test('runPlanner devuelve el plan YA formateado en líneas', async () => {
  const r = await runPlanner({
    chatImpl: async () => '{"done":true,"summary":"1. leer a.js 2. editar a.js 3. correr tests"}',
    tools: {}, task: 'x'
  });
  assert.equal(r.plan, '1. leer a.js\n2. editar a.js\n3. correr tests');
});

test('isNumberedPlan distingue un plan real de una narración', () => {
  assert.equal(isNumberedPlan('1. Crear el módulo\n2. Crear el componente'), true);
  assert.equal(isNumberedPlan('1. Un solo paso también vale'), true);
  assert.equal(isNumberedPlan('Exploré la estructura del proyecto y descubrí que no puedo crear archivos.'), false);
  assert.equal(isNumberedPlan(''), false);
});

test('runPlanner RECHAZA prosa narrativa: no se ofrece ejecutar algo que no es un plan', async () => {
  // El caso real: el modelo chico narra su exploración en vez de planear (y reincide en el reintento).
  const narrativa = 'Exploré la estructura del proyecto y encontré que solo contiene un README. En mi próximo paso necesito explorar las herramientas.';
  const r = await runPlanner({ chatImpl: async () => JSON.stringify({ done: true, summary: narrativa }), tools: {}, task: 'x' });
  assert.equal(r.plan, '');                       // NO califica como plan
  assert.match(r.error, /prosa/);
  assert.match(r.narrative, /Exploré la estructura/);   // pero se conserva para mostrarla tenue
});

test('runPlanner REINTENTA una vez con corrección explícita cuando responde prosa', async () => {
  const users = [];
  let call = 0;
  const chatImpl = async ({ user }) => {
    users.push(user);
    call++;
    // 1er intento: prosa; 2º (tras la corrección): plan numerado.
    return call === 1
      ? '{"done":true,"summary":"I explored the project and created a stub module."}'
      : '{"done":true,"summary":"1. Create the module 2. Create the component"}';
  };
  const r = await runPlanner({ chatImpl, tools: {}, task: 'crear módulo de usuarios' });
  assert.equal(r.plan, '1. Create the module\n2. Create the component');   // el reintento salvó el plan
  // el 2º prompt lleva el feedback correctivo (en inglés: es para el modelo)
  assert.match(users[users.length - 1], /NOT a plan/);
  assert.match(users[users.length - 1], /NOTHING has been created yet/);
  assert.match(users[users.length - 1], /crear módulo de usuarios/);   // la tarea original se conserva
});

test('planItems separa los ítems numerados (también de un plan pegado en una línea)', () => {
  assert.deepEqual(planItems('1. Crear el módulo\n2. Crear el componente\n3. Tests'), ['1. Crear el módulo', '2. Crear el componente', '3. Tests']);
  assert.deepEqual(planItems('1. a 2. b'), ['1. a', '2. b']);   // formatPlan lo separa primero
  assert.deepEqual(planItems('prosa sin números'), []);
});

test('stepTask acota el turno a UN solo paso y marca los previos como hechos', () => {
  const items = ['1. Crear el módulo', '2. Crear el componente'];
  const t0 = stepTask('crear feature usuarios', items, 0);
  assert.match(t0, /Execute ONLY step 1/);
  assert.match(t0, /crear feature usuarios/);       // el objetivo del usuario viaja como contexto
  assert.doesNotMatch(t0, /ALREADY DONE/);          // en el paso 1 no hay previos
  const t1 = stepTask('crear feature usuarios', items, 1);
  assert.match(t1, /Execute ONLY step 2/);
  assert.match(t1, /Steps 1-1 are ALREADY DONE/);
  assert.match(t1, /only this step/);
});

test('stepNeedsMutation detecta pasos que deben modificar el proyecto (es/en)', () => {
  assert.equal(stepNeedsMutation('2. Crea un archivo mockup en src/app/features/users'), true);
  assert.equal(stepNeedsMutation('4. Escribe las pruebas unitarias para cada componente'), true);
  assert.equal(stepNeedsMutation('3. Implement the business logic in the services'), true);
  assert.equal(stepNeedsMutation('1. Lee el README y entiende las convenciones'), false);
  assert.equal(stepNeedsMutation('1. Explore the project structure'), false);
});

test('stepRetryTask exige ejecutar de verdad tras un done sin cambios', () => {
  const t = stepRetryTask('crear feature', ['1. Crea el servicio'], 0);
  assert.match(t, /Execute ONLY step 1/);
  assert.match(t, /NOTHING happened/);
  assert.match(t, /write\/edit\/bash/);
  assert.match(t, /only AFTER an observation confirms/);
});

test('planSection arma la sección requerida con el título del idioma', () => {
  const s = planSection('1. Hacer algo', 'es');
  assert.equal(s.key, 'plan');
  assert.equal(s.required, true);
  assert.match(s.text, /plan approved by the user/);
  assert.match(s.text, /1\. Hacer algo/);
});

test('flujo completo: session.plan propone y ask({plan}) ejecuta con el plan en el prompt', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }),
    'src/app.js': 'const version = 1;\n'
  });
  try {
    // Guion en dos fases: el planner lee y entrega plan; el coder recibe el plan y edita.
    const systems = [];
    const turns = [
      '{"action":{"tool":"read","args":{"path":"src/app.js"}}}',
      '{"done":true,"summary":"1. Cambiar version a 2 en src/app.js"}',
      '{"action":{"tool":"edit","args":{"path":"src/app.js","old":"const version = 1;","new":"const version = 2;"}}}',
      '{"done":true,"summary":"plan ejecutado"}'
    ];
    let i = 0;
    const chatImpl = async ({ system }) => { systems.push(system); return turns[Math.min(i++, turns.length - 1)]; };
    const session = await createSession({ projectPath: dir, chatImpl, language: 'es' });

    const p = await session.plan('sube la versión a 2');
    assert.match(p.plan, /Cambiar version a 2/);
    assert.match(systems[0], /PLANNER/);          // el planner llevaba su rol
    assert.doesNotMatch(systems[0], /- write:/);            // ...y su índice de tools NO ofrecía write

    const result = await session.ask('sube la versión a 2', { plan: p.plan });
    assert.equal(result.done, true);
    const coderSystem = systems[systems.length - 2];        // primer system de la fase coder
    assert.match(coderSystem, /plan approved by the user/);
    assert.match(coderSystem, /Cambiar version a 2/);
    assert.match(coderSystem, /- write:/);                  // el coder SÍ tiene tools de escritura
    assert.equal(await readFile(join(dir, 'src', 'app.js'), 'utf8'), 'const version = 2;\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('un ask normal (sin plan) no lleva sección de plan', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    let system = '';
    const session = await createSession({ projectPath: dir, chatImpl: async (m) => { system = m.system; return '{"done":true,"summary":"ok"}'; }, language: 'es' });
    await session.ask('tarea directa');
    assert.doesNotMatch(system, /plan aprobado/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---- planfile: órdenes de trabajo persistidas en .chalc/plan.md (líder planea 1 vez; harness marca) ----
import { savePlan, loadPlan, markStepDone, planPath, PLAN_REL, specPath, loadSpec, specInfo, specTarget, goalSlug } from '../cli/engine/planfile.mjs';

test('savePlan/loadPlan: el plan aprobado queda como checklist retomable en .chalc/plan.md', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    const file = savePlan(dir, 'listar usuarios', '1. Crear el componente en src/app/features/users\n2. Conectar la ruta');
    assert.equal(file, planPath(dir));
    const text = await readFile(file, 'utf8');
    assert.match(text, /# Plan: listar usuarios/);
    assert.match(text, /- \[ \] 1\. Crear el componente/);
    const saved = loadPlan(dir);
    assert.equal(saved.goal, 'listar usuarios');
    assert.equal(saved.items.length, 2);
    assert.equal(saved.pending, 2);
    assert.deepEqual(saved.items.map((i) => i.done), [false, false]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('markStepDone: marca [x] SOLO la tarea indicada (idempotente) y nunca borra', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    savePlan(dir, 'meta', '1. a\n2. b\n3. c');
    assert.equal(markStepDone(dir, 1), true);
    let saved = loadPlan(dir);
    assert.deepEqual(saved.items.map((i) => i.done), [false, true, false]);
    assert.equal(saved.pending, 2);
    assert.equal(markStepDone(dir, 1), false);   // ya estaba marcada: sin cambios, sin error
    assert.equal(markStepDone(dir, 9), false);   // índice fuera de rango: no toca nada
    saved = loadPlan(dir);
    assert.equal(saved.items.length, 3);         // marcar jamás elimina tareas (bitácora auditable)
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('loadPlan: null sin archivo, y un plan nuevo REEMPLAZA al anterior', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    assert.equal(loadPlan(dir), null);
    assert.equal(loadPlan(undefined), null);     // sesión sin projectPath: sin drama
    assert.equal(savePlan(dir, 'meta', 'prosa sin items numerados'), null);   // sin ítems → no se escribe
    savePlan(dir, 'meta vieja', '1. a\n2. b');
    markStepDone(dir, 0);
    savePlan(dir, 'meta nueva', '1. x');
    const saved = loadPlan(dir);
    assert.equal(saved.goal, 'meta nueva');
    assert.equal(saved.pending, 1);              // el checklist viejo (y sus marcas) no contamina el nuevo
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('plan.md es un documento legible: líder, estado vivo y la orden exacta que recibe el junior', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    savePlan(dir, 'listar empleados', '1. Crear la interfaz\n2. Crear el componente', { leader: 'anthropic/claude-opus-4.8 (openrouter)' });
    let text = await readFile(planPath(dir), 'utf8');
    assert.match(text, /> Líder: anthropic\/claude-opus-4\.8 \(openrouter\)/);
    assert.match(text, /> Estado: 0\/2 completadas/);
    assert.match(text, /## Órdenes literales al junior/);
    assert.match(text, /### Tarea 1/);
    assert.match(text, /Execute ONLY step 1 of the approved plan/);   // la orden real, no una paráfrasis
    assert.match(text, /### Tarea 2/);
    assert.match(text, /Execute ONLY step 2 of the approved plan/);   // TODAS las tareas, no solo un ejemplo
    assert.match(text, /Steps 1-1 are ALREADY DONE/);                 // el framing completo de la orden 2
    markStepDone(dir, 0);
    text = await readFile(planPath(dir), 'utf8');
    assert.match(text, /> Estado: 1\/2 completadas/);                 // el estado se actualiza al marcar
    // el bloque de la orden (indentado) NO contamina el parseo del checklist
    const saved = loadPlan(dir);
    assert.equal(saved.items.length, 2);
    assert.equal(saved.pending, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('stepIsSpecWork: REDACTAR un spec es del líder; ejecutar código (aunque cite el spec) es del dev', () => {
  // redacción de documentos de especificación → agente LÍDER
  assert.equal(stepIsSpecWork('1. Crear specs/001-listar-cliente/tasks.md siguiendo el formato de _template/tasks.md'), true);
  assert.equal(stepIsSpecWork('2. Crear specs/001-listar-cliente/spec.md con los requisitos EARS'), true);
  assert.equal(stepIsSpecWork('3. Actualizar la especificación con los criterios de aceptación'), true);
  assert.equal(stepIsSpecWork('4. Write the contract.md for the employees API'), true);
  // trabajo de código — incluso cuando REFERENCIA un spec como fuente — → agente DESARROLLADOR
  assert.equal(stepIsSpecWork('1. Crear el componente en src/app/features/employee'), false);
  assert.equal(stepIsSpecWork('2. Implementar el endpoint según specs/001/contract.md'), false);
  assert.equal(stepIsSpecWork('3. Crea el test que falla (TDD Red) para la validación del correo'), false);
  assert.equal(stepIsSpecWork('4. Ejecutar ng build y corregir errores'), false);
});

test('stepTask ordena al dev construir EXACTO lo del plan/spec: leer specs ante dudas, jamás escribirlos', () => {
  const t = stepTask('crear feature', ['1. Crear el componente'], 0);
  assert.match(t, /READ the project spec documents/);
  assert.match(t, /NEVER invent requirements/);
  assert.match(t, /NEVER write or modify a spec document/);
});

test('splitPlanSpec separa el plan del spec por ---SPEC--- (y sin marcador todo es plan)', () => {
  const summary = '1. Crear el modelo\n2. Crear el componente\n---SPEC---\n## Task 1\narchivo: worker.ts\n## Task 2\narchivo: list.ts';
  const { plan, spec } = splitPlanSpec(summary);
  assert.equal(plan, '1. Crear el modelo\n2. Crear el componente');
  assert.match(spec, /^## Task 1/);
  assert.match(spec, /## Task 2/);
  // tolerante al formato del marcador (más guiones, espacios, minúsculas)
  assert.equal(splitPlanSpec('1. a\n---- spec ----\nX').spec, 'X');
  // sin marcador: comportamiento clásico (plan completo, sin spec)
  const solo = splitPlanSpec('1. a\n2. b');
  assert.equal(solo.plan, '1. a\n2. b');
  assert.equal(solo.spec, '');
});

test('specSectionFor extrae SOLO la sección de la tarea (Task/Tarea, ##/###); "" si no está documentada', () => {
  const spec = '## Task 1\narchivo: a.ts\ncriterio: compila\n## Task 2\narchivo: b.ts\nAPI: signals';
  assert.match(specSectionFor(spec, 0), /archivo: a\.ts/);
  assert.doesNotMatch(specSectionFor(spec, 0), /b\.ts/);        // la sección ajena NO viaja
  assert.match(specSectionFor(spec, 1), /API: signals/);
  assert.equal(specSectionFor(spec, 5), '');                    // tarea sin sección: sin inventos
  assert.equal(specSectionFor('', 0), '');
  assert.match(specSectionFor('### Tarea 1\nx', 0), /x/);       // variante en español y ###
});

test('stepTask con spec: la orden viaja con SU sección como fuente de verdad (y solo la suya)', () => {
  const spec = '## Task 1\narchivo: worker.ts\n## Task 2\narchivo: list.ts';
  const t = stepTask('crear feature', ['1. Crear modelo', '2. Crear componente'], 1, spec);
  assert.match(t, /SPEC for THIS step/);
  assert.match(t, /written by the leader/);
  assert.match(t, /list\.ts/);
  assert.doesNotMatch(t, /worker\.ts/);                         // la sección de OTRA tarea no contamina
  const retry = stepRetryTask('crear feature', ['1. Crear modelo', '2. Crear componente'], 1, spec);
  assert.match(retry, /list\.ts/);                              // el reintento conserva el spec
  assert.match(retry, /NOTHING happened/);
});

test('runPlanner devuelve plan y spec separados; la puerta de calidad juzga solo el plan', async () => {
  const turns = ['{"done":true,"summary":"1. Crear a.ts\\n2. Crear b.ts\\n---SPEC---\\n## Task 1\\narchivo a.ts\\n## Task 2\\narchivo b.ts"}'];
  const r = await runPlanner({ chatImpl: async () => turns[0], tools: {}, task: 'crear feature', language: 'es' });
  assert.equal(r.plan, '1. Crear a.ts\n2. Crear b.ts');         // el spec NO contamina el checklist
  assert.match(r.spec, /## Task 1/);
  assert.match(r.spec, /## Task 2/);
});

test('savePlan persiste el spec del líder (fallback .chalc sin carpeta specs/), lo enlaza y embebe cada sección', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    const spec = '## Task 1\narchivo: worker.ts\n## Task 2\narchivo: list.ts';
    savePlan(dir, 'listar trabajadores', '1. Crear el modelo\n2. Crear el componente', { leader: 'opus', spec });
    assert.equal(loadSpec(dir).includes('## Task 1'), true);    // spec persistido y recargable (retomar)
    const specText = await readFile(specPath(dir), 'utf8');
    assert.match(specText, /# Spec: listar trabajadores/);
    assert.match(specText, /Redactado por el líder: opus/);
    const planText = await readFile(planPath(dir), 'utf8');
    assert.match(planText, /> Spec: \.chalc\/spec\.md/);        // el plan RELACIONA el spec
    assert.match(planText, /SPEC for THIS step/);               // las órdenes literales llevan su sección
    assert.match(planText, /archivo: worker\.ts/);
    // un plan nuevo SIN spec borra el spec fallback del plan anterior (nada de specs huérfanos)
    savePlan(dir, 'otra meta', '1. x');
    assert.equal(loadSpec(dir), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('con carpeta specs/ en el proyecto el spec del líder se crea AHÍ (convención SDD del usuario)', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }),
    'specs/001-listar-cliente/spec.md': 'spec del usuario (spec-ia)',
    'specs/_template/spec.md': 'plantilla'
  });
  try {
    // meta nueva → siguiente carpeta NNN-slug dentro de specs/
    savePlan(dir, 'listar trabajadores', '1. Crear modelo\n2. Crear componente', { leader: 'opus', spec: '## Task 1\narchivo: worker.ts\n## Task 2\narchivo: list.ts' });
    let info = specInfo(dir);
    assert.equal(info.rel, 'specs/002-listar-trabajadores/spec.md');
    assert.match(info.text, /## Task 1/);
    assert.match(await readFile(join(dir, 'specs/002-listar-trabajadores/spec.md'), 'utf8'), /chalc:plan-spec/);   // sellado como nuestro
    // idempotente: re-planear la MISMA meta reúsa la carpeta (sin duplicar 003-)
    savePlan(dir, 'listar trabajadores', '1. a', { spec: '## Task 1\nv2' });
    assert.equal(specInfo(dir).rel, 'specs/002-listar-trabajadores/spec.md');
    assert.match(specInfo(dir).text, /v2/);
    // anti-destrucción: slug que coincide con carpeta del USUARIO → spec-plan.md al lado, jamás pisa su spec.md
    savePlan(dir, 'listar cliente', '1. a', { spec: '## Task 1\nw' });
    assert.equal(specInfo(dir).rel, 'specs/001-listar-cliente/spec-plan.md');
    assert.equal(await readFile(join(dir, 'specs/001-listar-cliente/spec.md'), 'utf8'), 'spec del usuario (spec-ia)');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('goalSlug y specTarget: slug corto sin acentos; el fallback .chalc solo sin carpeta specs/', async () => {
  assert.equal(goalSlug('Crear un componente para listar los empleados'), 'crear-un-componente-para-listar');   // máx 5 palabras
  assert.equal(goalSlug('Diseño & validación'), 'diseno-validacion');                                           // acentos y símbolos fuera
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    assert.equal(specTarget(dir, 'x').rel, '.chalc/spec.md');   // sin specs/: fallback junto al plan
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('plan.md declara QUIÉN ejecuta cada tarea: specs al LÍDER, código al DESARROLLADOR', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    savePlan(dir, 'listar clientes', '1. Crear specs/001-listar-cliente/spec.md con requisitos\n2. Crear el componente en src/app/features/clientes');
    const text = await readFile(planPath(dir), 'utf8');
    assert.match(text, /### Tarea 1 — la redacta el agente LÍDER \(documento de especificación\)/);
    assert.match(text, /### Tarea 2 — la ejecuta el agente DESARROLLADOR/);
    // la anotación del ejecutor no rompe el parseo ni el marcado del checklist
    const saved = loadPlan(dir);
    assert.equal(saved.items.length, 2);
    assert.equal(markStepDone(dir, 0), true);
    assert.equal(loadPlan(dir).pending, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
