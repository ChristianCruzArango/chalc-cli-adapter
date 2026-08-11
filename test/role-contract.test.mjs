// T2–T5 (R1, R3, R4, R13) — el alcance de un rol, declarado una vez como dato.
//
// Hoy ese alcance vive en dos sitios que nadie obliga a coincidir: la constante `REVIEWER_TOOLS` de
// `lib/targetkit.mjs`, que es lo que Claude Code concede de verdad, y la prosa del prompt, que es lo
// que el rol cree que puede hacer. Cuando la spec 008 necesitó que el revisor dejara bitácora hubo
// que tocar la constante, la plantilla y un test que afirmaba lo contrario — y que los tres acabaran
// de acuerdo dependió de acordarse.
//
// La verificación dura está en T4: un rol que no declara nada en `writes` **no puede** recibir una
// herramienta de escritura. Eso no es una convención, es lo que impide que un revisor acabe editando
// el código que revisa.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { AGENTS_DIR, loadRoles, toolsFor } from '../lib/roles.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'MultiEdit'];

// ── T2: la forma del contrato ─────────────────────────────────────────────────────────────────

test('R1 — todo rol declara id, orden, cadencia, resumen bilingüe y alcance', async () => {
  const roles = await loadRoles();
  assert.ok(roles.length, 'no se cargó ningún rol');

  for (const role of roles) {
    assert.match(role.id, /^[a-z][a-z0-9-]*$/, `${role.id}: el id aparece en la bitácora, debe ser estable`);
    assert.equal(typeof role.order, 'number', `${role.id}: falta order`);
    assert.ok(['task', 'feature'].includes(role.cadence), `${role.id}: cadencia inválida "${role.cadence}"`);
    assert.ok(role.summary?.es && role.summary?.en, `${role.id}: el resumen va en los dos idiomas`);
    assert.ok(Array.isArray(role.writes), `${role.id}: writes debe ser una lista, aunque esté vacía`);
    assert.ok(Array.isArray(role.tools), `${role.id}: tools debe ser una lista`);
  }
});

test('R1 — los órdenes son únicos: el ciclo no puede depender de readdir', async () => {
  const orders = (await loadRoles()).map((r) => r.order);
  assert.equal(new Set(orders).size, orders.length);
});

test('R1 — todo rol trae su prompt en los dos idiomas', async () => {
  for (const role of await loadRoles()) {
    for (const file of ['agent.md', 'agent.en.md']) {
      const text = await readFile(join(AGENTS_DIR, role.id, file), 'utf8');
      assert.ok(text.trim().length > 200, `${role.id}/${file}: el prompt está vacío o es un esbozo`);
    }
  }
});

test('R13 — los contratos son datos: solo JSON, y todos parsean', async () => {
  for (const role of await loadRoles()) {
    const file = join(AGENTS_DIR, role.id, 'contract.json');
    await assert.doesNotReject(async () => JSON.parse(await readFile(file, 'utf8')), `${role.id}: contrato inválido`);
  }
});

// ── T3: la carga ──────────────────────────────────────────────────────────────────────────────

test('R1 — los roles se cargan ordenados por order', async () => {
  const orders = (await loadRoles()).map((r) => r.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test('R4 — un contrato corrupto se descarta sin tumbar la carga de los demás', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-roles-roto-'));
  await mkdir(join(dir, 'roto'), { recursive: true });
  await writeFile(join(dir, 'roto', 'contract.json'), '{ no soy json', 'utf8');
  await mkdir(join(dir, 'bueno'), { recursive: true });
  await writeFile(join(dir, 'bueno', 'contract.json'), JSON.stringify({
    id: 'bueno', order: 1, cadence: 'task', summary: { es: 'a', en: 'a' }, writes: [], tools: ['Read']
  }), 'utf8');

  assert.deepEqual((await loadRoles(dir)).map((r) => r.id), ['bueno']);
});

test('R4 — una carpeta sin contrato no es un rol', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-roles-sin-'));
  await mkdir(join(dir, 'documentacion'), { recursive: true });
  await writeFile(join(dir, 'documentacion', 'LEEME.md'), 'hola', 'utf8');

  assert.deepEqual(await loadRoles(dir), []);
});

// ── T4: la verificación dura ──────────────────────────────────────────────────────────────────

test('R3 — un rol sin `writes` no puede recibir NINGUNA herramienta de escritura', async () => {
  for (const tool of WRITE_TOOLS) {
    const role = { id: 'mirón', order: 1, cadence: 'task', summary: { es: 'a', en: 'a' }, writes: [], tools: ['Read', tool] };
    assert.throws(() => toolsFor(role), /mirón/, `${tool} debería rechazarse en un rol que no escribe`);
  }
});

test('R3 — un rol que declara writes sí puede recibir Write', () => {
  const role = { id: 'anotador', order: 1, cadence: 'task', summary: { es: 'a', en: 'a' }, writes: ['.chalc/x.md'], tools: ['Read', 'Write'] };
  assert.deepEqual(toolsFor(role), ['Read', 'Write']);
});

test('R3 — `Edit` no se concede ni aunque el rol declare writes: edita lo que ya existe', () => {
  // Escribir una bitácora propia y modificar código ajeno no son el mismo permiso. Un rol de
  // revisión que pueda editar deja de ser una segunda opinión.
  const role = { id: 'editor', order: 1, cadence: 'task', summary: { es: 'a', en: 'a' }, writes: ['.chalc/x.md'], tools: ['Read', 'Edit'] };
  assert.throws(() => toolsFor(role), /editor/);
});

test('R3 — TODOS los roles del catálogo pasan la verificación', async () => {
  for (const role of await loadRoles()) {
    assert.doesNotThrow(() => toolsFor(role), `${role.id}: su contrato concede más de lo que declara`);
  }
});

test('R3 — las herramientas concedidas son EXACTAMENTE las del contrato, sin añadidos', async () => {
  for (const role of await loadRoles()) {
    assert.deepEqual(toolsFor(role), role.tools, `${role.id}: la derivación añade o quita herramientas`);
  }
});

// ── T5: añadir un rol es añadir una carpeta ───────────────────────────────────────────────────

test('R4 — un rol que el código nunca vio se carga igual', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-roles-nuevo-'));
  await mkdir(join(dir, 'documentador'), { recursive: true });
  await writeFile(join(dir, 'documentador', 'contract.json'), JSON.stringify({
    id: 'documentador', order: 30, cadence: 'feature',
    summary: { es: 'Revisa la documentación', en: 'Reviews the documentation' },
    writes: [], forbiddenWrites: ['**'], tools: ['Read', 'Grep']
  }), 'utf8');

  const roles = await loadRoles(dir);
  assert.equal(roles.length, 1);
  assert.equal(roles[0].id, 'documentador');
  assert.deepEqual(toolsFor(roles[0]), ['Read', 'Grep']);
});

test('R1 — el catálogo de roles vive junto al resto de lo que se proyecta al repo', () => {
  assert.equal(AGENTS_DIR, join(ROOT, 'catalog', 'agents'));
});

// ── el revisor de hoy, ya como contrato ───────────────────────────────────────────────────────

test('R14 — el contrato del revisor declara lo que hoy tiene concedido', async () => {
  const revisor = (await loadRoles()).find((r) => r.id === 'revisor');

  assert.ok(revisor, 'el revisor tiene que seguir existiendo');
  assert.deepEqual([...revisor.tools].sort(), ['Bash', 'Glob', 'Grep', 'Read', 'Write']);
  assert.deepEqual(revisor.writes, ['.chalc/review.md']);
  assert.equal(revisor.cadence, 'task');
});

// ── T16 (R9, R15) — los roles llegan a `.chalc/gate.json` ─────────────────────────────────────

test('R15 — la config detectada declara los roles con su cadencia y su orden', async () => {
  const { detectGateConfig } = await import('../lib/gatedetect.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'chalc-roles-cfg-'));

  const config = await detectGateConfig(dir, { role: 'back', language: 'es' });

  assert.ok(Array.isArray(config.flow.roles), 'flow.roles debe ser una lista ordenada');
  for (const role of await loadRoles()) {
    const entry = config.flow.roles.find((r) => r.id === role.id);
    assert.ok(entry, `falta el rol ${role.id} en la config`);
    assert.equal(entry.cadence, role.cadence, `${role.id}: la cadencia por defecto sale del contrato`);
    assert.equal(entry.order, role.order);
    assert.equal(entry.required, true, `${role.id}: por defecto se exige`);
  }
});

test('R9 — lo que el usuario ajustó en flow.roles se conserva al re-equipar', async () => {
  const { loadConfig } = await import('../catalog/gate/lib/config.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'chalc-roles-merge-'));
  await mkdir(join(dir, '.chalc'), { recursive: true });
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({
    flow: { roles: [{ id: 'endurecedor', order: 20, cadence: 'task', required: false }] }
  }), 'utf8');

  const { config } = await loadConfig(dir);
  const entry = config.flow.roles.find((r) => r.id === 'endurecedor');

  assert.equal(entry.required, false, 'apagar un rol se respeta');
  assert.equal(entry.cadence, 'task', 'subir su cadencia se respeta');
});

test('R3 — la lista concedida es una copia: tocarla no corrompe el contrato', async () => {
  // `toolsFor` se llama una vez por target; si devolviera la lista del contrato por referencia, un
  // target que la ordenara o recortara afectaría a los demás.
  const revisor = (await loadRoles()).find((r) => r.id === 'revisor');
  const granted = toolsFor(revisor);
  granted.push('Edit');

  assert.ok(!revisor.tools.includes('Edit'), 'el contrato quedó contaminado');
  assert.ok(!toolsFor(revisor).includes('Edit'), 'la siguiente llamada arrastra la contaminación');
});
