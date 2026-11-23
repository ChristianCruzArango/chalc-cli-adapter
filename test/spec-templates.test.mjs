// Spec 024 (coherencia), T9 — lo que chalc EMITE para que la coherencia sea posible (R18, R19): `hu.md` en las
// plantillas de los cuatro scaffolds, plantillas que no nacen incoherentes, y las reglas SDD con el bloqueo explícito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tasksIn, requirementsIn } from '../catalog/gate/lib/specparse.mjs';
import { parseHu } from '../catalog/gate/lib/huids.mjs';

const SDD = new URL('../catalog/methods/sdd/', import.meta.url);
const SCAFFOLDS = ['scaffold-lite', 'scaffold-lite-en', 'scaffold-full', 'scaffold-full-en'];
const RULES = ['rules-lite.md', 'rules-full.md', 'rules-lite.en.md', 'rules-full.en.md'];
const template = (scaffold, name) => readFile(new URL(`${scaffold}/specs/_template/${name}`, SDD), 'utf8');

for (const scaffold of SCAFFOLDS) {
  test(`R19 (${scaffold}): la plantilla trae hu.md con su Fuente y la lista de fragmentos HU-n`, async () => {
    assert.ok(existsSync(new URL(`${scaffold}/specs/_template/hu.md`, SDD)));
    const hu = await template(scaffold, 'hu.md');
    assert.match(hu, /^(Fuente|Source):/m);
    assert.deepEqual(parseHu(hu).fragments.map((f) => f.id), ['HU-1']);
  });

  test(`R19 (${scaffold}): tasks.md no trae la tarea Tm y toda tarea de ejemplo cita un requisito`, async () => {
    const tasks = await template(scaffold, 'tasks.md');
    assert.doesNotMatch(tasks, /\*\*Tm\*\*/);
    const items = tasksIn(tasks);
    assert.ok(items.length >= 3);
    for (const { line, text } of items) assert.match(text, /\bR\d+\b/, `línea ${line}: ${text}`);
    // Spec 030: cada tarea lleva sus tests y su código; el rojo se registra, no se parte en dos tareas.
    assert.ok(tasks.includes('node .chalc/gate.mjs --red'));
    assert.doesNotMatch(tasks, /para pasar T1|to pass T1/);
  });

  test(`R19 (${scaffold}): los requisitos de ejemplo de spec.md citan su fragmento HU-n`, async () => {
    const requirements = requirementsIn(await template(scaffold, 'spec.md'));
    assert.ok(requirements.length >= 3);
    for (const { id, text } of requirements) assert.match(text, /\(HU-\d+\)/, id);
  });
}

for (const file of RULES) {
  test(`R18 (${file}): las reglas emitidas llevan el bloqueo explícito y cómo capturar la HU`, async () => {
    const rules = await readFile(new URL(file, SDD), 'utf8');
    for (const needle of ['hu.md', 'fix_specs', 'approve_spec', 'node .chalc/gate.mjs --approve-spec', 'chalc spec --azure', 'especificador', 'analista']) {
      assert.ok(rules.includes(needle), `${file} debe nombrar ${needle}`);
    }
    assert.match(rules, file.endsWith('.en.md') ? /Source:/ : /Fuente:/);
    assert.match(rules, file.endsWith('.en.md') ? /only the user approves/i : /solo el usuario aprueba/i);
    assert.match(rules, file.endsWith('.en.md') ? /no tests or code/i : /ni tests ni código/i);
  });

  test(`spec 028, R11 (${file}): el cierre lo aprueba solo el usuario y no hay aprobación por tarea`, async () => {
    const rules = await readFile(new URL(file, SDD), 'utf8');
    for (const needle of ['approve_feature', 'node .chalc/gate.mjs --approve-feature']) assert.ok(rules.includes(needle), `${file} debe nombrar ${needle}`);
    assert.doesNotMatch(rules, /párate y espera OK|stop and wait for OK/);
    assert.match(rules, file.endsWith('.en.md') ? /no per-task approval/i : /no hay aprobación por tarea/i);
  });

  test(`spec 030, R12 (${file}): las reglas describen el rojo sellado`, async () => {
    const rules = await readFile(new URL(file, SDD), 'utf8');
    for (const needle of ['node .chalc/gate.mjs --red', 'red_task', '--skip']) assert.ok(rules.includes(needle), `${file} debe nombrar ${needle}`);
  });

  test(`R19 (${file}): las reglas ya no describen chalc spec como «solo carpeta y archivos vacíos»`, async () => {
    const rules = await readFile(new URL(file, SDD), 'utf8');
    assert.doesNotMatch(rules, /archivos vacíos|empty folder and files/);
  });
}

// ── Spec 033 (worktrees y olas), T6 — el plan declara qué toca la spec (R1) ───────────────────────────────

const { planScope } = await import(new URL('../catalog/team/lib/scope.mjs', import.meta.url).href);

for (const scaffold of SCAFFOLDS) {
  test(`033 R1 (${scaffold}): plan.md pide Toca: y Depende de:, y sus huecos no cuentan como rutas`, async () => {
    const plan = await template(scaffold, 'plan.md');
    const en = scaffold.endsWith('-en');
    assert.match(plan, en ? /^Touches:/m : /^Toca:/m);
    assert.match(plan, en ? /^Depends on:/m : /^Depende de:/m);
    assert.deepEqual(planScope(plan), { touches: [], dependsOn: [] });
    // Rellenada, la plantilla se lee tal cual.
    const filled = plan.replace(/^- <[^>\n]*\*\*>$/m, '- src/pagos/**').replace(/^(Depende de|Depends on): <[^>\n]*>$/m, '$1: 027-checkout');
    assert.deepEqual(planScope(filled), { touches: ['src/pagos/**'], dependsOn: ['027-checkout'] });
  });
}

for (const rules of RULES) {
  test(`033 R1 (${rules}): las reglas del método piden declarar el alcance en el plan`, async () => {
    const text = await readFile(new URL(rules, SDD), 'utf8');
    assert.ok(text.includes(rules.endsWith('.en.md') ? '`Touches:`' : '`Toca:`'));
    assert.ok(text.includes(rules.endsWith('.en.md') ? '`Depends on:`' : '`Depende de:`'));
  });
}
