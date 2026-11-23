// Specs 024, 028, 030, 034, 036 — lo que el advisor y la memoria le DICEN a quien trabaja, con sus palabras exactas.
// Los demás tests comprueban qué acción sale; estos, que el motivo trae cada dato en su sitio y en los dos idiomas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { reasonOf } from '../catalog/next/lib/i18n.mjs';
import { run } from '../catalog/memory/memory.mjs';
import { mark, readMemory, remember } from '../catalog/memory/lib/store.mjs';
import { MAX_PROMOTED, lessonsFor, setPromoted } from '../catalog/memory/lib/lessons.mjs';
import { loadConcepts } from '../catalog/memory/lib/concepts.mjs';

const problem = (n) => ({ file: 'specs/001-x/spec.md', line: n, rule: 'requirement-no-hu', data: { id: `R${n}` } });

test('024 R9: `fix_specs` dice de qué carpeta, a quién encargarlo y cuántos problemas hay; con muchos, cuántos faltan', () => {
  const many = Array.from({ length: 14 }, (_, i) => problem(i + 1));
  const es = reasonOf('fix_specs', { dir: 'specs/001-x', author: 'especificador', problems: many }, 'es');
  assert.ok(es.startsWith('La spec de `specs/001-x` no es coherente todavía (14 problema(s)). No escribas tests ni código: corrige esto primero, encargándolo al agente `especificador`. specs/001-x/spec.md:1 — '), es);
  assert.ok(es.endsWith(' (+2 más)'), es);
  assert.equal(es.split('; ').length, 12, 'doce como mucho, separados por punto y coma');
  assert.ok(es.includes('specs/001-x/spec.md:12 — ') && !es.includes('spec.md:13 — '));
  const en = reasonOf('fix_specs', { dir: 'specs/001-x', author: 'especificador', problems: many }, 'en');
  assert.ok(en.startsWith('The spec in `specs/001-x` is not coherent yet (14 problem(s)). Write no tests or code: fix this first, handing it to the `especificador` agent. specs/001-x/spec.md:1 — '), en);
  assert.ok(en.endsWith(' (+2 more)'), en);
  const bare = reasonOf('fix_specs', { dir: '', author: '', problems: many.slice(0, 12) }, 'es');
  assert.ok(bare.startsWith('La spec no es coherente todavía (12 problema(s)). No escribas tests ni código: corrige esto primero. specs/'), bare);
  assert.equal(bare.includes('más)'), false, 'justo doce: no falta ninguno');
  assert.ok(reasonOf('fix_specs', { dir: '', author: '', problems: many.slice(0, 1) }, 'en').startsWith('The spec is not coherent yet (1 problem(s)). Write no tests or code: fix this first. specs/'));
});

test('030: `red_task` nombra la tarea, el avance y los requisitos que hay que citar', () => {
  const facts = { task: 'T2 (R1, R3)', done: 1, total: 4, requirements: ['R1', 'R3'], memory: [] };
  assert.equal(reasonOf('red_task', facts, 'es'), 'Toca «T2 (R1, R3)» (1/4 hechas). Primero SOLO los tests de sus criterios (R1, R3; cítalos en los tests): escríbelos, compruébalos en rojo y regístralos con el COMMAND. '
    + 'Nada de código de producción todavía: el portón lo rechaza sin el rojo. Si la tarea de verdad no lleva tests, añade --skip "<motivo>".');
  const en = reasonOf('red_task', facts, 'en');
  assert.ok(en.startsWith('Next up: "T2 (R1, R3)" (1/4 done). First ONLY the tests'), en);
  assert.ok(en.includes('(R1, R3; ') && en.includes('write them, see them fail and register them with the COMMAND.') && en.endsWith('add --skip "<reason>".'), en);
  const none = reasonOf('red_task', { ...facts, requirements: [] }, 'es');
  assert.ok(none.includes('los tests de sus criterios: escríbelos'), none);
  assert.ok(reasonOf('red_task', { task: 'T1', done: 0, total: 1 }, 'en').includes('criteria: write them'), 'sin lista de requisitos tampoco falla');
});

test('008, 028, 034: marcar la tarea cuenta la que se cierra; el rol de cierre y la entrega dicen cuándo', () => {
  assert.ok(reasonOf('tick_task', { task: 'T2', done: 1, total: 4 }, 'es').endsWith('marca «T2» en tasks.md (2/4).'));
  assert.ok(reasonOf('tick_task', { task: 'T2', done: 1, total: 4 }, 'en').includes('(2/4)'));
  const role = { role: 'endurecedor', cadence: 'feature', evidenceDate: Date.parse('2026-11-22T10:00:00Z'), findings: 0, memory: [], prior: [], requirements: [] };
  assert.ok(reasonOf('call_role', role, 'es').includes('falta que pase el agente `endurecedor` antes de dar la feature por terminada.'));
  assert.ok(reasonOf('call_role', { ...role, role: 'revisor', cadence: 'task' }, 'es').includes('falta que pase el agente `revisor` por esta tarea.'));
  assert.ok(reasonOf('call_role', role, 'en').includes('the `endurecedor` agent still has to run before the feature can be called done.'));
  assert.ok(reasonOf('call_role', { ...role, role: 'revisor', cadence: 'task' }, 'en').includes('still has to run for this task.'));
  const approve = { dir: 'specs/001-x', fingerprint: 'f'.repeat(16), total: 3 };
  assert.ok(reasonOf('approve_feature', approve, 'es').endsWith('en SU terminal, con el COMMAND. Entrégale el resumen de lo hecho y espera su OK explícito; no ejecutes tú el comando.'));
  assert.ok(reasonOf('approve_feature', approve, 'en').includes('in THEIR terminal, with the COMMAND.'));
  assert.equal(reasonOf('deliver_spec', { dir: 'specs/001-x', total: 3 }, 'es'), 'Las 3 tareas de `specs/001-x` están hechas y el portón aprobó. Commitea todo y entrega con el COMMAND: no llames tú a quien revisa ni pidas el cierre; eso lo hace quien te despachó.');
});

// ── la memoria ────────────────────────────────────────────────────────────────────────────────────
async function store(t, language) {
  const root = await tempDir(t, 'chalc-036-golden-');
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ language }));
  return root;
}
const TTY = { isTTY: true };
const rule = (n, extra = {}) => ({ key: `x:regla-${n}`, kind: 'rule', concepts: [], title: `Regla ${n}`, files: [], ...extra });

for (const [lang, said] of [
  ['es', { none: 'Nada se ha repetido todavía.', terminal: 'Promover o retirar una lección la decide el usuario: ejecútalo en una terminal interactiva.', promoted: (id) => `${id} es ahora regla de todo el equipo: va en cada orden.`,
    demoted: (id) => `${id} ya no es regla de todo el equipo.`, full: 'Ya hay 20 lecciones promovidas, el tope: retira alguna (demote) antes de promover otra.', missing: (id) => `No hay ninguna entrada con id ${id}.` }],
  ['en', { none: 'Nothing has been repeated yet.', terminal: 'Promoting or removing a lesson is decided by the user: run it in an interactive terminal.', promoted: (id) => `${id} is now a rule for the whole team: it goes in every order.`,
    demoted: (id) => `${id} is no longer a rule for the whole team.`, full: 'There are already 20 promoted lessons, the cap: remove one (demote) before promoting another.', missing: (id) => `There is no entry with id ${id}.` }]
]) {
  test(`036 R6, R7 (${lang}): lo que dice la memoria al listar, promover y retirar`, async (t) => {
    const root = await store(t, lang);
    assert.deepEqual(await run(['candidates'], root), { code: 0, out: said.none });
    for (let n = 0; n <= MAX_PROMOTED; n += 1) await remember(root, rule(n));
    await remember(root, rule(0));
    const { entries } = await readMemory(root);
    const id = (n) => entries.find((e) => e.key === `x:regla-${n}`).id;
    assert.deepEqual(await run(['candidates'], root), { code: 0, out: `${id(0)} · rule · Regla 0 · ×2` });
    assert.deepEqual(await run(['promote', id(0)], root), { code: 1, out: said.terminal });
    assert.deepEqual(await run(['promote', id(0)], root, new Date(), TTY), { code: 0, out: said.promoted(id(0)) });
    assert.deepEqual(await run(['demote', id(0)], root, new Date(), TTY), { code: 0, out: said.demoted(id(0)) });
    assert.deepEqual(await run(['promote', 'nadie000'], root, new Date(), TTY), { code: 1, out: said.missing('nadie000') });
    assert.deepEqual(await run(['promote'], root, new Date(), TTY), { code: 1, out: said.missing('') });
    for (let n = 0; n < MAX_PROMOTED; n += 1) await mark(root, `x:regla-${n}`, { promoted: true });
    assert.deepEqual(await run(['promote', id(MAX_PROMOTED)], root, new Date(), TTY), { code: 1, out: said.full });
    assert.equal(await setPromoted(root, id(3), true), '', 'volver a promover una ya promovida no choca con el tope');
    assert.equal(await setPromoted(root, id(MAX_PROMOTED), false), '', 'retirar siempre se puede');
  });
}

test('036 R5: las lecciones de una spec: sin memoria ninguna; las promovidas siempre; las del concepto declarado, también', async (t) => {
  const root = await store(t, 'es');
  assert.deepEqual(await lessonsFor(root, 'Conceptos: dinero\n'), []);
  const concept = Object.keys(await loadConcepts(root))[0];
  const related = await remember(root, rule(1, { concepts: [concept] }));
  const other = await remember(root, rule(2, { concepts: ['otro-concepto'] }));
  const kept = await remember(root, rule(3));
  await mark(root, kept.key, { promoted: true });
  assert.deepEqual(await lessonsFor(root, `# Spec\n\nConceptos: ${concept}\n`), [{ id: kept.id, title: 'Regla 3', promoted: true }, { id: related.id, title: 'Regla 1', promoted: false }]);
  assert.deepEqual(await lessonsFor(root, ''), [{ id: kept.id, title: 'Regla 3', promoted: true }]);
  assert.deepEqual(await lessonsFor(root, null), [{ id: kept.id, title: 'Regla 3', promoted: true }]);
  assert.ok(other.id);
});
