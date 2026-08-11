// lib/toolskill.mjs — la skill `mutation-testing`, renderizada desde la tabla (spec 011, R5, R8-R10).
// Responsabilidad ÚNICA: convertir la tabla de herramientas en el texto que lee el asistente.
// Razón de cambio: qué le decimos al asistente sobre mutación.
//
// Antes, esa skill llevaba escritas a mano las mismas cuatro tablas que la detección conocía por su
// lado. La spec 007 pidió en R20 que coincidieran, pero R20 es una instrucción a quien edita: se
// cumplía a mano y a mano se rompía. Una ruta de reporte cambiada en un sitio y no en el otro deja
// al asistente configurando la herramienta para que escriba donde el portón no mira, y la tarea
// bloquea en cada corrida por seguir la guía al pie de la letra.
//
// La skill va en INGLÉS: `catalog/skills/**` es material en un solo idioma. Lo que sí es bilingüe es
// lo que chalc muestra por consola, y aquí no se muestra nada.

import { parserFor } from './tooltable.mjs';
import { FORMATS } from '../catalog/gate/lib/mutation.mjs';

// El bloque de mutación REPRESENTATIVO de un stack, para la tabla general. Cada regla lo guarda en
// un sitio distinto; esta función es el único lugar que lo sabe.
function representative(stack) {
  const rule = stack.mutation;
  if (!rule) return null;
  if (rule.rule === 'fixed') return rule.value || null;
  if (rule.rule === 'byLookup') return { ...rule.base, ...rule.template };
  if (rule.rule === 'bySignal') return rule.cases?.[0]?.value || null;
  return null;
}

const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|');

const code = (value) => (value ? `\`${cell(value)}\`` : '—');

// El formato que declara un stack, mirando donde su regla lo ponga.
const formatOf = (stack) => representative(stack)?.format || '';

// ── {{TOOL_TABLE}} ────────────────────────────────────────────────────────────────────────────

function toolTable(stacks) {
  const rows = stacks.map((stack) => {
    const tools = representative(stack);
    const verifiable = parserFor(formatOf(stack));
    return `| ${cell(stack.label)} | ${code(tools?.install)} | ${code(tools?.command)} | ${
      verifiable ? code(tools?.report) : '**no parser yet**'} |`;
  });

  return [
    '| Language | Install once, project-local (if missing) | Run | Native report the gate parses |',
    '|---|---|---|---|',
    ...rows
  ].join('\n');
}

// ── {{RUNNER_TABLE}} ──────────────────────────────────────────────────────────────────────────

// El mapeo framework→runner sale de las variantes declaradas por los stacks que las tengan. No se
// pregunta por `js`: si mañana otro stack usa la misma mecánica, entra solo.
function runnerTable(stacks) {
  const rows = stacks
    .flatMap((stack) => stack.mutation?.variants || [])
    .map((v) => `| ${cell(v.label || v.id)} | \`@stryker-mutator/${cell(v.runner)}\` |`);

  return ['| Detected unit-test framework | Runner plugin |', '|---|---|', ...rows].join('\n');
}

// ── {{UNPARSED}} ──────────────────────────────────────────────────────────────────────────────

// Qué stacks NO puede verificar el portón. Sale de cruzar el `format` declarado con el registro real
// de parsers (R7): antes era una frase mantenida a mano, y añadir un parser obligaba a acordarse de
// tacharla aquí.
function unparsed(stacks) {
  const names = stacks.filter((s) => !parserFor(formatOf(s))).map((s) => s.label);
  if (!names.length) return 'The gate has a report parser for every stack in the table.';

  return [
    `${names.join(', ')} have no report parser in the gate. There the mutation stage ends as a`,
    '**BLOCKER** by default, and that is deliberate: the gate says "I could not verify this", never',
    '"this passed".',
    '',
    'Two honest ways out — pick one **with the user**, never on your own:',
    '',
    `1. **Configure a tool the gate can read.** Point \`mutation.command\`, \`mutation.report\` and`,
    `   \`mutation.format\` in \`.chalc/gate.json\` at a tool that writes one of the supported formats`,
    `   (${FORMATS.map((f) => `\`${f}\``).join(', ')}).`,
    '2. **Declare the stage not applicable**: set `"required": false` inside `mutation` in',
    '   `.chalc/gate.json`. The stage is then reported as *not applicable* instead of blocking, and the',
    '   reason is recorded in `.chalc/gate.md` on every run. This only works where the gate has **no',
    '   parser for the stack** — on a repo it can measure, the flag is ignored and the stage runs anyway.'
  ].join('\n');
}

// ── {{REPORT_SETUP}} ──────────────────────────────────────────────────────────────────────────

// El ajuste que cada herramienta necesita para escribir su reporte DONDE el portón lo lee. Dos lo
// necesitan y es justo donde más fácil se rompe la coherencia: Stryker no escribe el JSON por
// defecto y mutmut imprime por pantalla. La ruta se sustituye desde la misma fila, así que no puede
// discrepar del `report` que acaba en `.chalc/gate.json`.
function reportSetup(stacks) {
  const blocks = stacks
    .map((stack) => ({ stack, tools: representative(stack) }))
    .filter(({ tools }) => tools?.setup)
    .map(({ tools }) => `- ${tools.setup.replace(/\{report\}/g, tools.report)}`);

  return blocks.length ? blocks.join('\n\n') : 'No tool in the table needs extra setup to write its report.';
}

// ── {{MY_STACK}} ──────────────────────────────────────────────────────────────────────────────

// La sección del stack de ESTE repo, con lo que la detección resolvió de verdad. La skill se abre a
// mitad de una tarea para resolver una duda concreta; nueve filas de las que ocho no aplican se leen
// en diagonal (R9).
function myStack(stack, tools) {
  if (!stack) {
    return [
      '> **This repo\'s stack could not be detected.** chalc did not resolve it from the root signals,',
      '> so no per-stack guidance is given here — use the full table below, and fill',
      '> `test.command` and `mutation.*` in `.chalc/gate.json` yourself.'
    ].join('\n');
  }

  const mutation = tools?.mutation;
  if (!mutation) {
    // Dos causas MUY distintas caben aquí, y confundirlas manda a arreglar lo que no es: puede que
    // el stack no tenga herramienta estándar (nada que configurar), o que sí la tenga y la detección
    // no supiera cuál variante — típicamente, un proyecto JS sin framework de test reconocible.
    const hasTool = !!representative(stack);
    return [
      `> **This repo: ${stack.label}.** Tests: ${code(tools?.test)}.`,
      '>',
      hasTool
        ? '> chalc could not resolve WHICH mutation tool variant fits this repo — the detection was\n'
          + '> ambiguous or found no test framework. Pick one from the table below and complete\n'
          + '> `mutation.command`, `mutation.report` and `mutation.format` in `.chalc/gate.json`.'
        : '> This stack has no standard mutation tool, so chalc could not configure one.',
      '>',
      '> Until those fields are filled, the mutation stage blocks — the gate says "I could not verify',
      '> this", never "this passed".',
      ...(hasTool ? [] : ['>', unparsed([stack]).split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')])
    ].join('\n');
  }

  const verifiable = parserFor(mutation.format);
  return [
    `> **This repo: ${stack.label}.**`,
    '>',
    `> - Tests: ${code(tools?.test)}`,
    `> - Install (project-local, never \`-g\`): ${code(mutation.install)}`,
    `> - Run: ${code(mutation.command)}`,
    `> - Report the gate reads: ${code(mutation.report)} (format ${code(mutation.format)})`,
    verifiable
      ? '>\n> The gate can verify this stack: make the tool write its report exactly where that path says.'
      : `>\n> ${unparsed([stack]).split('\n').join('\n> ').trimEnd()}`
  ].join('\n');
}

// ── el renderizador ───────────────────────────────────────────────────────────────────────────

// Sustituye los marcadores de la skill. Un marcador desconocido se deja TAL CUAL: borrarlo en
// silencio escondería una errata, y verlo en el repo equipado la delata en el acto.
export function renderMutationSkill(text, { stacks = [], stack = null, tools = null } = {}) {
  const blocks = {
    MY_STACK: () => myStack(stack, tools),
    TOOL_TABLE: () => toolTable(stacks),
    RUNNER_TABLE: () => runnerTable(stacks),
    UNPARSED: () => unparsed(stacks),
    REPORT_SETUP: () => reportSetup(stacks)
  };

  return String(text).replace(/\{\{(\w+)\}\}/g, (whole, name) => (blocks[name] ? blocks[name]() : whole));
}
