// T13–T15 (R5, R7, R8, R9, R10) — la skill `mutation-testing` renderizada desde la tabla.
//
// Hoy esa skill lleva escritas a mano las mismas cuatro tablas que la detección conoce por su lado.
// La spec 007 pidió en R20 que coincidieran, pero R20 no es verificable: es una instrucción a quien
// edita. Cambiar la ruta del reporte en un sitio y no en el otro deja al asistente configurando la
// herramienta para que escriba donde el portón no mira — y la tarea bloquea en cada corrida por
// seguir la guía al pie de la letra.
//
// Rendrizarla desde la misma fila convierte R20 en una propiedad estructural.
//
// La skill va en inglés: `catalog/skills/**` es material en un solo idioma, sin paridad que mantener.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadToolTable } from '../lib/tooltable.mjs';
import { renderMutationSkill } from '../lib/toolskill.mjs';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const stacks = await loadToolTable();

const byId = (id) => stacks.find((s) => s.id === id);

const render = (text, over = {}) => renderMutationSkill(text, { stacks, stack: null, tools: null, ...over });

// ── T13: la tabla completa y el mapeo de runners ──────────────────────────────────────────────

test('R5 — {{TOOL_TABLE}} lista TODOS los stacks de la tabla', () => {
  const out = render('{{TOOL_TABLE}}');

  for (const stack of stacks) {
    assert.ok(out.includes(stack.label), `falta la fila de ${stack.id} (${stack.label})`);
  }
});

test('R5 — cada fila trae el comando y la ruta del reporte que el portón espera', () => {
  const out = render('{{TOOL_TABLE}}');

  assert.ok(out.includes('mvn org.pitest:pitest-maven:mutationCoverage'), 'falta el comando de PIT');
  assert.ok(out.includes('target/pit-reports/**/mutations.xml'), 'falta el reporte de PIT');
  assert.ok(out.includes('mutmut run && mutmut junitxml > reports/mutation/mutmut.xml'), 'falta el de mutmut');
  assert.ok(out.includes('reports/mutation/mutation.json'), 'falta el de Stryker JS');
  assert.ok(out.includes('StrykerOutput/**/reports/mutation-report.json'), 'falta el de Stryker.NET');
});

test('R5 — {{RUNNER_TABLE}} sale de las variantes de js, no de una copia', () => {
  const out = render('{{RUNNER_TABLE}}');

  for (const variant of byId('js').mutation.variants) {
    assert.ok(out.includes(variant.label), `falta el framework ${variant.id}`);
    assert.ok(out.includes(`@stryker-mutator/${variant.runner}`), `falta el runner de ${variant.id}`);
  }
});

test('R5 — un marcador desconocido se deja como está, no se borra en silencio', () => {
  assert.equal(render('{{NO_EXISTE}}'), '{{NO_EXISTE}}');
});

test('R5 — el texto que rodea a los marcadores no se toca', () => {
  const out = render('antes\n{{RUNNER_TABLE}}\ndespués');

  assert.match(out, /^antes\n/);
  assert.match(out, /\ndespués$/);
});

// ── T14: quién no se puede verificar sale del cruce, no de una lista ──────────────────────────

test('R7, R8 — {{UNPARSED}} nombra los stacks sin parser y NO los que sí tienen', () => {
  const out = render('{{UNPARSED}}');

  for (const id of ['dart', 'rust', 'php']) {
    assert.ok(out.includes(byId(id).label), `${id} no tiene parser y debería aparecer`);
  }
  for (const id of ['maven', 'python']) {
    assert.ok(!out.includes(byId(id).label), `${id} SÍ se puede verificar y no debe aparecer`);
  }
});

test('R8 — {{UNPARSED}} ofrece la salida aplicable y dice qué formatos sí se leen', () => {
  const out = render('{{UNPARSED}}');

  assert.match(out, /required.*false|"required": false/, 'falta la salida de R21 de la spec 007');
  for (const format of ['elements', 'junit', 'pit']) {
    assert.ok(out.includes(format), `falta el formato soportado ${format}`);
  }
});

test('R7 — si un stack ganara parser, saldría solo de la lista', () => {
  // Se simula añadiendo un stack con un formato que el portón SÍ sabe leer: no debe aparecer.
  const extra = { id: 'fake', label: 'Inventado', priority: 99, detect: { files: ['x'] },
    test: { rule: 'fixed', value: 'x' },
    mutation: { rule: 'fixed', value: { tool: 't', command: 'c', report: 'r', format: 'pit', install: '' } } };

  const out = renderMutationSkill('{{UNPARSED}}', { stacks: [...stacks, extra], stack: null, tools: null });
  assert.ok(!out.includes('Inventado'), 'un stack con parser no puede figurar como no verificable');
});

// ── T15: la sección del stack de ESTE repo ────────────────────────────────────────────────────

const jsTools = {
  test: 'npm test',
  mutation: {
    tool: 'stryker', command: 'npx --no-install stryker run',
    report: 'reports/mutation/mutation.json', format: 'elements',
    install: 'npm i -D @stryker-mutator/core @stryker-mutator/jest-runner',
    probe: 'node_modules/.bin/stryker', scopeFlag: '--mutate'
  }
};

test('R9 — {{MY_STACK}} trae el comando, la instalación y el reporte de ESTE repo', () => {
  const out = render('{{MY_STACK}}', { stack: byId('js'), tools: jsTools });

  assert.ok(out.includes('npm i -D @stryker-mutator/core @stryker-mutator/jest-runner'), 'falta la instalación resuelta');
  assert.ok(out.includes('npx --no-install stryker run'), 'falta el comando');
  assert.ok(out.includes('reports/mutation/mutation.json'), 'falta el reporte');
});

test('R9 — {{MY_STACK}} dice si el portón puede verificar este stack', () => {
  const verifiable = render('{{MY_STACK}}', { stack: byId('js'), tools: jsTools });
  const not = render('{{MY_STACK}}', { stack: byId('rust'), tools: { test: 'cargo test', mutation: null } });

  assert.notEqual(verifiable, not);
  assert.match(not, /required.*false|"required": false/, 'sin parser hay que ofrecer la salida');
});

test('R9 — el runner resuelto es el del repo, no la plantilla con el hueco', () => {
  const out = render('{{MY_STACK}}', { stack: byId('js'), tools: jsTools });

  assert.ok(!out.includes('{runner}'), 'el hueco de la plantilla no puede llegar al repo');
});

test('R10 — sin stack detectado se dice, y NO se elige uno por defecto', () => {
  const out = render('{{MY_STACK}}', { stack: null, tools: null });

  assert.match(out, /could not|not detect|no stack/i, 'tiene que decir que la detección no resolvió');
  for (const stack of stacks) {
    assert.ok(!out.includes(stack.label), `no puede insinuar que el repo es ${stack.id}`);
  }
});

test('R10 — un stack detectado pero con la mutación sin resolver no inventa comando', () => {
  const out = render('{{MY_STACK}}', { stack: byId('js'), tools: { test: 'npm test', mutation: null } });

  assert.ok(!out.includes('npx --no-install stryker run'), 'sin framework detectado no hay comando que dar');
  assert.match(out, /gate\.json/, 'debe remitir al archivo donde se completa a mano');
});

// ── T16: la skill del catálogo ya no lleva las tablas a mano ──────────────────────────────────

test('R5 — la plantilla declara los cinco marcadores', async () => {
  const skill = await readFile(join(ROOT, 'catalog', 'skills', 'mutation-testing', 'SKILL.template.md'), 'utf8');

  for (const marker of ['{{MY_STACK}}', '{{TOOL_TABLE}}', '{{RUNNER_TABLE}}', '{{UNPARSED}}', '{{REPORT_SETUP}}']) {
    assert.ok(skill.includes(marker), `falta ${marker} en la skill del catálogo`);
  }
});

test('R5 — la plantilla ya no repite a mano ningún dato de la tabla', async () => {
  // Es la duplicación que la spec 011 viene a quitar: si vuelve, R20 de la 007 vuelve a depender de
  // que alguien se acuerde de tocar los dos sitios.
  const skill = await readFile(join(ROOT, 'catalog', 'skills', 'mutation-testing', 'SKILL.template.md'), 'utf8');

  for (const stack of stacks) {
    const rule = stack.mutation;
    const block = rule?.value || rule?.base || rule?.cases?.[0]?.value;
    for (const key of ['command', 'report', 'install']) {
      const literal = block?.[key];
      if (literal) assert.ok(!skill.includes(literal), `SKILL.md repite a mano "${literal}"`);
    }
  }
});

test('R5 — renderizarla no deja ningún marcador sin sustituir', async () => {
  const skill = await readFile(join(ROOT, 'catalog', 'skills', 'mutation-testing', 'SKILL.template.md'), 'utf8');
  const out = renderMutationSkill(skill, { stacks, stack: byId('js'), tools: jsTools });

  assert.ok(!/\{\{\w+\}\}/.test(out), `quedaron marcadores: ${out.match(/\{\{\w+\}\}/g)}`);
});

// ── la plantilla y el documento del catálogo no pueden divergir ────────────────────────────────

// `catalog/skills/mutation-testing/SKILL.md` está commiteado YA RENDERIZADO, y eso es deliberado: el
// catálogo no es solo material de reparto, es también lo que se lee al desarrollar chalc, donde
// `mutation-testing` es una skill activa según CLAUDE.md. Un archivo lleno de `{{MARCADORES}}` sería
// inservible ahí.
//
// El riesgo evidente de tener el generado commiteado es que se quede viejo. Este test lo impide.
test('R5 — SKILL.md es exactamente lo que produce su plantilla, sin stack', async () => {
  const dir = join(ROOT, 'catalog', 'skills', 'mutation-testing');
  const template = await readFile(join(dir, 'SKILL.template.md'), 'utf8');
  const committed = await readFile(join(dir, 'SKILL.md'), 'utf8');

  assert.equal(
    committed,
    renderMutationSkill(template, { stacks, stack: null, tools: null }),
    'SKILL.md quedó desactualizado respecto a SKILL.template.md o a la tabla de herramientas'
  );
});

test('R5 — el SKILL.md del catálogo se lee entero, sin marcadores', async () => {
  const committed = await readFile(join(ROOT, 'catalog', 'skills', 'mutation-testing', 'SKILL.md'), 'utf8');
  assert.equal(committed.match(/\{\{\w+\}\}/g), null, 'el catálogo no puede quedar con marcadores en crudo');
});
