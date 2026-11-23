// coherence.mjs — coherencia HU ↔ spec ↔ plan ↔ tareas de la carpeta activa (spec 024, R2–R8, R22, R23, R25).
// Responsabilidad ÚNICA: decir qué impide pasar a tests y código. Razón de cambio: qué se exige a una spec.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// PURO y sin IA: recibe los textos y devuelve hallazgos `{ file, line, rule, data }`. Lo que pide entender
// (que el plan resuelva de verdad, que nada de la HU se haya torcido) es del rol `analista`.

import { RULES } from './rules.mjs';
import { designProblems, probesProblems } from './designspec.mjs';
import { ACTIVE_SPEC_REL } from './spec.mjs';
import { SPEC_FILES } from './specset.mjs';
import { huHash } from './specprint.mjs';
import { parseHu } from './huids.mjs';
import { citationsIn, requirementsIn, tasksIn, withoutInlineCode } from './specparse.mjs';

const REQUIREMENT_ID = /\bR\d+\b/g;
const HU_ID = /\bHU-\d+\b/g;
// Sin `\b`: no reconoce el límite de palabra tras una letra acentuada (DEBERÁ).
const EARS = /(?<!\p{L})(?:SHALL|DEBE|DEBERÁ)(?!\p{L})/u;
const CLARIFY = /\[NEEDS CLARIFICATION/g;

const finding = (file, line, rule, data = {}) => ({ file, line, rule, data });
const idsOf = (text, pattern) => [...new Set(text.match(pattern) || [])];

function huProblems(file, hu, seal) {
  const { source, body, fragments } = parseHu(hu);
  const found = [];
  if (!body) found.push(finding(file, 1, RULES.huEmpty));
  if (!source) found.push(finding(file, 1, RULES.huNoSource));
  if (!fragments.length) found.push(finding(file, 1, RULES.huNoFragments));
  for (const { id, line, fragment } of fragments) {
    if (!fragment || !body.includes(fragment)) found.push(finding(file, line, RULES.huFragmentNotLiteral, { id }));
  }
  if (seal && seal.hu !== huHash(hu)) found.push(finding(file, 1, RULES.huChanged));
  return found;
}

function specProblems(file, spec) {
  const requirements = requirementsIn(spec);
  const found = requirements.length ? [] : [finding(file, 1, RULES.specNoRequirements)];
  for (const { id, line, text } of requirements) {
    if (!EARS.test(text)) found.push(finding(file, line, RULES.requirementNotEars, { id }));
  }
  for (const { line } of citationsIn(withoutInlineCode(spec), CLARIFY)) found.push(finding(file, line, RULES.needsClarification));
  return found;
}

// Requisitos ↔ fragmentos de la HU (R23): nada inventado, nada omitido.
function huLinkProblems(dir, spec, hu) {
  const fragments = parseHu(hu).fragments;
  const declared = new Set(fragments.map((f) => f.id));
  const cited = new Set();
  const found = [];
  for (const { id, line, text } of requirementsIn(spec)) {
    const refs = idsOf(text, HU_ID);
    refs.forEach((ref) => cited.add(ref));
    if (!refs.length) found.push(finding(`${dir}/spec.md`, line, RULES.requirementNoHu, { id }));
    for (const ref of refs.filter((r) => !declared.has(r))) found.push(finding(`${dir}/spec.md`, line, RULES.requirementUnknownHu, { id, hu: ref }));
  }
  for (const { id, line } of fragments.filter((f) => !cited.has(f.id))) found.push(finding(`${dir}/hu.md`, line, RULES.huUncited, { id }));
  return found;
}

function planProblems(file, plan, known) {
  return citationsIn(plan, REQUIREMENT_ID).filter(({ id }) => !known.has(id))
    .map(({ id, line }) => finding(file, line, RULES.planUnknownRequirement, { id }));
}

// `known` es null cuando no hay spec.md: se exige la cita, pero no se puede decir si es real.
function taskProblems(file, tasks, known) {
  const items = tasksIn(tasks);
  if (!items.length) return [finding(file, 1, RULES.tasksEmpty)];
  return items.flatMap(({ line, text }) => {
    const refs = idsOf(text, REQUIREMENT_ID);
    if (!refs.length) return [finding(file, line, RULES.taskNoRequirement)];
    return known ? refs.filter((id) => !known.has(id)).map((id) => finding(file, line, RULES.taskUnknownRequirement, { id })) : [];
  });
}

function uncovered(file, spec, tasks) {
  const covered = new Set(tasksIn(tasks).flatMap(({ text }) => idsOf(text, REQUIREMENT_ID)));
  return requirementsIn(spec).filter(({ id }) => !covered.has(id))
    .map(({ id, line }) => finding(file, line, RULES.requirementUncovered, { id }));
}

/** Los problemas de coherencia de `{ dir, problem, files, seal }` (lo que devuelve `specFacts`). */
export function coherenceProblems({ dir, problem, files, seal = null }) {
  if (!dir) return problem === 'active-spec-invalid' ? [finding(ACTIVE_SPEC_REL, 1, RULES.activeSpecInvalid)] : [];
  const at = (name) => `${dir}/${name}`;
  const { 'hu.md': hu, 'spec.md': spec, 'plan.md': plan, 'tasks.md': tasks } = files;
  const has = (text) => text !== null && text !== undefined;
  const known = has(spec) ? new Set(requirementsIn(spec).map((r) => r.id)) : null;
  return [
    ...SPEC_FILES.filter((name) => !has(files[name])).map((name) => finding(at(name), 1, RULES.specFileMissing, { name })),
    ...(has(hu) ? huProblems(at('hu.md'), hu, seal) : []),
    ...(has(spec) ? specProblems(at('spec.md'), spec) : []),
    ...(has(spec) && has(hu) ? huLinkProblems(dir, spec, hu) : []),
    ...(has(plan) && known ? planProblems(at('plan.md'), plan, known) : []),
    ...(has(tasks) ? taskProblems(at('tasks.md'), tasks, known) : []),
    ...(has(spec) && has(tasks) ? uncovered(at('spec.md'), spec, tasks) : []),
    ...designProblems(dir, files),
    ...probesProblems(dir, files)
  ];
}
