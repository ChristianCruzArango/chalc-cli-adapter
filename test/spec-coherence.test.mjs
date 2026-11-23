// Spec 024 (coherencia), T4 — comprobaciones mecánicas HU ↔ spec ↔ plan ↔ tareas (R2–R8, R22, R23, R25).
// Puras y sin IA: reciben los textos de la carpeta activa y devuelven hallazgos { file, line, rule, data }.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coherenceProblems } from '../catalog/gate/lib/coherence.mjs';
import { huHash } from '../catalog/gate/lib/specprint.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { MESSAGES } from '../catalog/gate/lib/i18n.mjs';

const DIR = 'specs/002-pagos';
const HU = [
  '# HU: pagos',
  '',
  'Fuente: https://dev.azure.com/org/proj/_workitems/edit/42',
  '',
  '<!-- comentario que no cuenta -->',
  '',
  '## Texto original',
  '',
  'Como cliente quiero pagar con tarjeta.',
  'El sistema rechaza tarjetas vencidas.',
  '',
  '## Fragmentos trazables',
  '',
  '- **HU-1** — pagar con tarjeta',
  '- **HU-2** — rechaza tarjetas vencidas'
].join('\n');
const SPEC = [
  '# Spec: pagos',
  '',
  '> Marca lo dudoso con `[NEEDS CLARIFICATION: ...]` y resuélvelo antes de planear.',
  '',
  '- **R1** (HU-1) — WHEN el cliente confirma el pago THE SYSTEM SHALL cobrar la tarjeta.',
  '- **R2** (HU-2) — IF la tarjeta está vencida',
  '  THEN THE SYSTEM SHALL rechazar el pago.',
  '',
  '_Ejemplo:_ **R9** — esto es un ejemplo en línea, no una declaración.'
].join('\n');
const PLAN = '# Plan\n\n- Servicio de cobro (R1).\n- Validación de vencimiento (R2).\n';
const TASKS = '# Tasks\n\n- [ ] **T1** (R1) — test de cobro\n- [x] **T2** (R2) — test de vencimiento\n';

const facts = (over = {}) => ({
  dir: DIR, problem: '', seal: null,
  files: { 'hu.md': HU, 'spec.md': SPEC, 'plan.md': PLAN, 'tasks.md': TASKS },
  ...over
});
const withFile = (name, text, over = {}) => facts({ ...over, files: { ...facts().files, [name]: text } });
const rules = (found) => found.map((f) => f.rule);
const only = (found, rule) => found.filter((f) => f.rule === rule);
const replaceLine = (text, from, to) => { assert.ok(text.includes(from), from); return text.replace(from, to); };

test('una carpeta coherente no tiene problemas', () => {
  assert.deepEqual(coherenceProblems(facts()), []);
});

test('R25: un active-spec inválido es el único problema y apunta al archivo', () => {
  assert.deepEqual(coherenceProblems(facts({ dir: null, problem: 'active-spec-invalid', files: {} })),
    [{ file: '.chalc/active-spec', line: 1, rule: RULES.activeSpecInvalid, data: {} }]);
});

test('sin carpeta activa no hay nada que comprobar', () => {
  assert.deepEqual(coherenceProblems(facts({ dir: null, problem: 'no-spec', files: {} })), []);
});

test('R2: cada archivo que falta se reporta con su nombre', () => {
  for (const name of ['hu.md', 'spec.md', 'plan.md', 'tasks.md']) {
    const found = only(coherenceProblems(withFile(name, null)), RULES.specFileMissing);
    assert.deepEqual(found, [{ file: `${DIR}/${name}`, line: 1, rule: RULES.specFileMissing, data: { name } }], name);
  }
});

test('R2: si falta spec.md no se inventan problemas de requisitos en plan ni tareas', () => {
  assert.deepEqual(rules(coherenceProblems(withFile('spec.md', null))), [RULES.specFileMissing]);
});

test('R3: una HU sin contenido propio (solo plantilla) se reporta', () => {
  const template = '# HU: <título>\n\nFuente: https://x/1\n\n<!-- copia aquí -->\n\n## Texto original\n\n<pega aquí el texto>\n\n## Fragmentos trazables\n- **HU-1** — <fragmento>\n';
  const found = coherenceProblems(withFile('hu.md', template));
  assert.ok(rules(found).includes(RULES.huEmpty));
  assert.deepEqual(only(found, RULES.huEmpty)[0], { file: `${DIR}/hu.md`, line: 1, rule: RULES.huEmpty, data: {} });
});

test('R3: la HU necesita una línea Fuente:/Source: con un origen real', () => {
  for (const line of ['Fuente: <URL del work item>', 'Fuente:', 'Fuente:   ']) {
    assert.ok(rules(coherenceProblems(withFile('hu.md', replaceLine(HU, 'Fuente: https://dev.azure.com/org/proj/_workitems/edit/42', line)))).includes(RULES.huNoSource), line);
  }
  assert.ok(rules(coherenceProblems(withFile('hu.md', replaceLine(HU, 'Fuente: https://dev.azure.com/org/proj/_workitems/edit/42\n', '')))).includes(RULES.huNoSource));
  for (const line of ['Source: historia.docx', 'fuente: tablero de Jira ABC-7']) {
    assert.equal(rules(coherenceProblems(withFile('hu.md', replaceLine(HU, 'Fuente: https://dev.azure.com/org/proj/_workitems/edit/42', line)))).includes(RULES.huNoSource), false, line);
  }
});

test('R4: una spec sin requisitos declarados se reporta (el ejemplo en línea no cuenta)', () => {
  const found = coherenceProblems(withFile('spec.md', '# Spec\n\n_Ejemplo:_ **R1** — WHEN x THE SYSTEM SHALL y\n'));
  assert.ok(rules(found).includes(RULES.specNoRequirements));
});

test('R4: un requisito sin SHALL (ni DEBE/DEBERÁ) en su bloque se reporta con su línea', () => {
  const spec = replaceLine(SPEC, 'WHEN el cliente confirma el pago THE SYSTEM SHALL cobrar la tarjeta.', 'el sistema cobra la tarjeta.');
  assert.deepEqual(only(coherenceProblems(withFile('spec.md', spec)), RULES.requirementNotEars),
    [{ file: `${DIR}/spec.md`, line: 5, rule: RULES.requirementNotEars, data: { id: 'R1' } }]);
});

test('R4: SHALL puede estar en la continuación del requisito, y DEBE/DEBERÁ valen', () => {
  assert.deepEqual(only(coherenceProblems(facts()), RULES.requirementNotEars), []);
  for (const verb of ['DEBE', 'DEBERÁ']) {
    const spec = SPEC.replace('THE SYSTEM SHALL cobrar', `EL SISTEMA ${verb} cobrar`);
    assert.deepEqual(only(coherenceProblems(withFile('spec.md', spec)), RULES.requirementNotEars), [], verb);
  }
});

test('R4: un [NEEDS CLARIFICATION sin resolver se reporta con su línea; citado como código, no', () => {
  const spec = SPEC + '\n\n## Dudas\n- [NEEDS CLARIFICATION: ¿moneda?]\n';
  assert.deepEqual(only(coherenceProblems(withFile('spec.md', spec)), RULES.needsClarification),
    [{ file: `${DIR}/spec.md`, line: 12, rule: RULES.needsClarification, data: {} }]);
  assert.deepEqual(only(coherenceProblems(facts()), RULES.needsClarification), []);
});

test('R5: el plan no puede citar un requisito que la spec no declara', () => {
  const found = only(coherenceProblems(withFile('plan.md', PLAN + '- Reembolsos (R7).\n')), RULES.planUnknownRequirement);
  assert.deepEqual(found, [{ file: `${DIR}/plan.md`, line: 5, rule: RULES.planUnknownRequirement, data: { id: 'R7' } }]);
});

test('R6: una tarea sin R#, con un R# inexistente, o un tasks.md sin tareas se reportan', () => {
  const noRef = TASKS + '- [ ] **T3** — refactor\n';
  assert.deepEqual(only(coherenceProblems(withFile('tasks.md', noRef)), RULES.taskNoRequirement),
    [{ file: `${DIR}/tasks.md`, line: 5, rule: RULES.taskNoRequirement, data: {} }]);
  const unknown = TASKS + '- [ ] **T3** (R1, R8) — otra\n';
  assert.deepEqual(only(coherenceProblems(withFile('tasks.md', unknown)), RULES.taskUnknownRequirement),
    [{ file: `${DIR}/tasks.md`, line: 5, rule: RULES.taskUnknownRequirement, data: { id: 'R8' } }]);
  assert.deepEqual(only(coherenceProblems(withFile('tasks.md', '# Tasks\n\nsin casillas\n')), RULES.tasksEmpty),
    [{ file: `${DIR}/tasks.md`, line: 1, rule: RULES.tasksEmpty, data: {} }]);
});

test('R6: la cita de una tarea puede estar en su línea de continuación', () => {
  const tasks = '- [ ] **T1** — test de cobro\n  cubre R1 y R2\n';
  assert.deepEqual(rules(coherenceProblems(withFile('tasks.md', tasks))), []);
});

test('R7: un requisito que ninguna tarea cubre se reporta en la línea donde se declara', () => {
  const found = only(coherenceProblems(withFile('tasks.md', '- [ ] **T1** (R1) — solo cobro\n')), RULES.requirementUncovered);
  assert.deepEqual(found, [{ file: `${DIR}/spec.md`, line: 6, rule: RULES.requirementUncovered, data: { id: 'R2' } }]);
});

test('R22: la HU debe declarar fragmentos trazables', () => {
  const hu = HU.split('\n').slice(0, -2).join('\n');
  assert.ok(rules(coherenceProblems(withFile('hu.md', hu))).includes(RULES.huNoFragments));
});

test('R22: un fragmento que no aparece literal en la HU se reporta con su id y su línea', () => {
  const hu = replaceLine(HU, '- **HU-2** — rechaza tarjetas vencidas', '- **HU-2** — bloquea tarjetas caducadas');
  assert.deepEqual(only(coherenceProblems(withFile('hu.md', hu)), RULES.huFragmentNotLiteral),
    [{ file: `${DIR}/hu.md`, line: 15, rule: RULES.huFragmentNotLiteral, data: { id: 'HU-2' } }]);
});

test('R22: el fragmento se compara con espacios normalizados y sin comillas envolventes', () => {
  for (const fragment of ['"rechaza tarjetas vencidas"', '«rechaza   tarjetas vencidas»', '“rechaza tarjetas vencidas”', 'pagar con tarjeta. El sistema rechaza']) {
    const hu = replaceLine(HU, '- **HU-2** — rechaza tarjetas vencidas', `- **HU-2** — ${fragment}`);
    assert.deepEqual(only(coherenceProblems(withFile('hu.md', hu)), RULES.huFragmentNotLiteral), [], fragment);
  }
});

test('R22: un fragmento no puede apoyarse en otra línea de ids ni en un marcador vacío', () => {
  const selfRef = replaceLine(HU, '- **HU-2** — rechaza tarjetas vencidas', '- **HU-2** — texto inventado\n- **HU-3** — texto inventado');
  assert.equal(only(coherenceProblems(withFile('hu.md', selfRef)), RULES.huFragmentNotLiteral).length, 2);
  const placeholder = replaceLine(HU, '- **HU-2** — rechaza tarjetas vencidas', '- **HU-2** — <fragmento copiado literal>');
  assert.equal(only(coherenceProblems(withFile('hu.md', placeholder)), RULES.huFragmentNotLiteral).length, 1);
});

test('R23: cada requisito cita un HU-n declarado, y cada HU-n lo cita algún requisito', () => {
  const noHu = replaceLine(SPEC, '- **R1** (HU-1) —', '- **R1** —');
  assert.deepEqual(only(coherenceProblems(withFile('spec.md', noHu)), RULES.requirementNoHu),
    [{ file: `${DIR}/spec.md`, line: 5, rule: RULES.requirementNoHu, data: { id: 'R1' } }]);
  assert.deepEqual(only(coherenceProblems(withFile('spec.md', noHu)), RULES.huUncited),
    [{ file: `${DIR}/hu.md`, line: 14, rule: RULES.huUncited, data: { id: 'HU-1' } }]);
  const unknown = replaceLine(SPEC, '- **R1** (HU-1) —', '- **R1** (HU-1, HU-9) —');
  assert.deepEqual(only(coherenceProblems(withFile('spec.md', unknown)), RULES.requirementUnknownHu),
    [{ file: `${DIR}/spec.md`, line: 5, rule: RULES.requirementUnknownHu, data: { id: 'R1', hu: 'HU-9' } }]);
});

test('R8: una HU cambiada después de sellarse se reporta hasta restaurarla o re-aprobarla', () => {
  const sealed = { dir: DIR, hu: huHash(HU), fingerprint: '0'.repeat(16), date: '2026-11-22T10:00:00.000Z', approvedBy: 'user' };
  assert.deepEqual(coherenceProblems(facts({ seal: sealed })), []);
  const changed = HU.replace('Como cliente', 'Como comprador');
  assert.deepEqual(only(coherenceProblems(withFile('hu.md', changed, { seal: sealed })), RULES.huChanged),
    [{ file: `${DIR}/hu.md`, line: 1, rule: RULES.huChanged, data: {} }]);
  assert.deepEqual(only(coherenceProblems(withFile('hu.md', changed)), RULES.huChanged), [], 'sin sello no hay contra qué comparar');
});

test('cada regla de coherencia tiene redacción en español y en inglés, con sus datos', () => {
  const data = { name: 'plan.md', id: 'R1', hu: 'HU-9' };
  const ids = ['activeSpecInvalid', 'specFileMissing', 'huEmpty', 'huNoSource', 'huNoFragments', 'huFragmentNotLiteral', 'huChanged', 'huUncited',
    'specNoRequirements', 'requirementNotEars', 'needsClarification', 'requirementNoHu', 'requirementUnknownHu', 'requirementUncovered',
    'planUnknownRequirement', 'taskNoRequirement', 'taskUnknownRequirement', 'tasksEmpty'];
  for (const key of ids) {
    assert.equal(typeof RULES[key], 'string', key);
    for (const lang of ['es', 'en']) {
      const line = MESSAGES[lang][RULES[key]](data, lang);
      assert.ok(typeof line === 'string' && line.length > 10, `${key} ${lang}`);
    }
    assert.notEqual(MESSAGES.es[RULES[key]](data, 'es'), MESSAGES.en[RULES[key]](data, 'en'), key);
  }
});
