// cli/engine/plan.mjs — F1 del orquestador multi-rol: modo PLAN (planner → aprobación humana → coder).
// El planner NO es un motor nuevo: es el MISMO runAgent con (a) tools de SOLO LECTURA, (b) una sección
// de instrucciones de rol y (c) pocos pasos. Su entregable es el done.summary: un plan numerado corto.
// Nada se escribe ni se ejecuta — el valor está en que el USUARIO aprueba el plan antes de que el coder
// toque un solo archivo (un plan malo de un modelo local envenenaría todo lo de abajo).

import { runAgent } from './loop.mjs';
import { createRenderPrompt } from './harness.mjs';
import { frame } from '../prompts/text.mjs';

// Tools sin capacidad de mutar: fs de lectura + describe (solo muestra esquemas MCP). recall lo maneja
// el propio loop. Cualquier write/edit/bash/mcp__* queda FUERA: si el planner los pide, el loop le
// responde "herramienta desconocida" y sigue.
const READ_ONLY = new Set(['read', 'list', 'grep', 'describe']);

export function readOnlyTools(tools = {}) {
  return Object.fromEntries(Object.entries(tools).filter(([name]) => READ_ONLY.has(name)));
}

// Separa el entregable del planner en PLAN (checklist numerado) y SPEC (el documento que el líder
// redacta él mismo), divididos por la línea ---SPEC---. El spec es OPCIONAL en el parseo: si el modelo
// no lo entregó, el plan funciona como siempre (sin spec no se inventa nada) — pero el prompt lo exige,
// porque el desarrollador jamás debe redactar los documentos que gobiernan su propio trabajo.
export function splitPlanSpec(summary) {
  const s = String(summary || '');
  const m = s.match(/^\s*-{2,}\s*SPEC\s*-{2,}\s*$/mi);
  if (!m) return { plan: s.trim(), spec: '' };
  const idx = s.indexOf(m[0]);
  return { plan: s.slice(0, idx).trim(), spec: s.slice(idx + m[0].length).trim() };
}

// Sección "## Task N" del spec para UN paso del plan (0-based). Extracción determinista por encabezado
// (tolera Task/Tarea y ##/###); '' si el spec no existe o no documenta ese paso — la orden viaja sin
// sección antes que con la sección EQUIVOCADA.
export function specSectionFor(spec, index) {
  const s = String(spec || '');
  if (!s) return '';
  const head = new RegExp(`^#{2,3}\\s*(?:Task|Tarea)\\s*${index + 1}\\b`, 'mi');
  const m = head.exec(s);
  if (!m) return '';
  const rest = s.slice(m.index + m[0].length);
  const next = rest.search(/^#{2,3}\s*(?:Task|Tarea)\s*\d+\b/mi);
  return s.slice(m.index, next === -1 ? s.length : m.index + m[0].length + next).trim();
}

// Los modelos locales suelen devolver el plan en UNA línea ("1. …2. …3. …"). Se inserta un salto antes
// de cada ítem numerado para mostrarlo e inyectarlo legible. Idempotente con planes ya multilínea.
export function formatPlan(plan) {
  return String(plan || '').trim().replace(/\s+(?=\d{1,2}\.\s)/g, '\n').trim();
}

// ¿Es un plan de verdad? Debe tener al menos un ítem numerado al inicio de línea. Los modelos chicos a
// veces NARRAN su exploración en vez de planear — eso NO califica: ejecutar prosa envenena al coder.
export function isNumberedPlan(text) {
  return /^\s*\d{1,2}[.)]\s/m.test(String(text));
}

// Ítems numerados del plan, en orden. El ORQUESTADOR recorre esta lista paso a paso (un turno del coder
// por ítem): darle el plan entero a un modelo local invita a ejecutar un paso y declarar todo hecho.
export function planItems(plan) {
  return formatPlan(plan)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d{1,2}[.)]\s/.test(l));
}

// Tarea del coder para UN paso del plan (en inglés: es para el modelo). Acota el alcance con dureza:
// los pasos previos ya están hechos y el turno termina cuando ESTE paso esté completo.
// spec (opcional): el documento que el LÍDER redactó junto al plan — a la orden viaja SOLO la sección
// de ESTA tarea (contexto pequeño pero bien documentado, tarea por tarea). Ante dudas, la fuente de
// verdad son los SPEC: se le ordena SEGUIRLOS/LEERLOS (nunca redactarlos) — el desarrollador ejecuta
// órdenes exactas, no inventa requisitos.
export function stepTask(goal, items, index, spec = '') {
  const section = specSectionFor(spec, index);
  return [
    `User goal: ${goal}`,
    `Execute ONLY step ${index + 1} of the approved plan: "${items[index]}".`,
    index > 0 ? `Steps 1-${index} are ALREADY DONE — do not redo them.` : '',
    section ? `SPEC for THIS step (written by the leader — your source of truth, follow it EXACTLY):\n${section}` : '',
    'Build EXACTLY what the plan and the spec state — nothing more. If anything is unclear, READ the project spec documents (.chalc/spec.md, specs/**) with the read tool and follow them; NEVER invent requirements and NEVER write or modify a spec document yourself.',
    'Finish with done as soon as THIS step is complete; your summary describes only this step.'
  ].filter(Boolean).join('\n');
}

// ¿El paso implica MODIFICAR el proyecto? (crear/implementar/escribir/corregir…). Si sí y el turno
// terminó sin tocar nada, el "done" del modelo fue una alucinación y hay que re-ejecutar.
const MUTATION_VERBS = /crea|crear|implementa|escribe|escrib|genera|agrega|añade|modifica|actualiza|corrige|refactor|create|implement|writ|generat|add|modify|updat|fix/i;
export function stepNeedsMutation(item) {
  return MUTATION_VERBS.test(String(item));
}

// ¿El paso REDACTA un documento de especificación? (spec.md, tasks.md, contratos, archivos bajo
// specs/…). Esos documentos GOBIERNAN el trabajo del desarrollador: si los escribiera él mismo, se
// estaría dictando sus propias órdenes — y un spec malo hecho por el junior envenena todo lo de
// abajo. Por eso el orquestador enruta estos pasos al rol PLANNER (el líder), no al coder.
// Detección determinista en dos partes: el paso debe (a) nombrar un entregable de especificación y
// (b) tener verbo de redacción/creación — nombrar un spec solo como REFERENCIA ("implementa según
// specs/001/contract.md") sigue siendo trabajo del desarrollador.
const SPEC_DOCS = /\bspecs?[\\/]|\b(?:spec|tasks|contract|contrato|requirements|requisitos)\.md\b|\bespecificaci[oó]n\b|\bspecification\b/i;
const SPEC_VERBS = /crea|crear|redacta|escrib|writ|creat|author|genera|generat|documenta|document|actualiza|updat/i;
export function stepIsSpecWork(item) {
  const s = String(item);
  return SPEC_DOCS.test(s) && SPEC_VERBS.test(s);
}

// Reintento anti-alucinación de UN paso: el turno anterior declaró done sin que las observaciones
// confirmen ningún cambio. Se le exige ejecutar de verdad (en inglés: es para el modelo).
export function stepRetryTask(goal, items, index, spec = '') {
  return [
    stepTask(goal, items, index, spec),
    '',
    'WARNING: your previous attempt claimed this step was done, but the observations show NO file was written or edited and NO command ran.',
    'NOTHING happened. Execute the step FOR REAL now using write/edit/bash; finish with done only AFTER an observation confirms the change.'
  ].join('\n');
}

// Corre el planner. Devuelve { plan, steps, interrupted?, error?, narrative? }: plan='' si no entregó
// nada usable (el orquestador decide qué hacer; nunca se ejecuta un plan vacío).
// Puerta de calidad + UN reintento: si responde prosa narrativa en vez del plan numerado, se le corrige
// una vez con feedback explícito (en inglés: es para el modelo); si reincide, se rechaza.
export async function runPlanner({ chatImpl, tools = {}, projectSections = [], task, budgetTokens, language, maxSteps = 6, onStep, shouldStop, ccr, maxRetries = 1 } = {}) {
  if (!task || !String(task).trim()) throw new Error('runPlanner requiere una tarea.');
  const f = frame(language);
  const roTools = readOnlyTools(tools);
  const sections = [...projectSections, { key: 'rol:planner', text: f.plannerRole, required: true }];
  let taskText = String(task).trim();
  let rejected = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const renderPrompt = createRenderPrompt({ task: taskText, tools: roTools, projectSections: sections, budgetTokens, language });
    const r = await runAgent({ chatImpl, tools: roTools, renderPrompt, ccr, maxSteps, onStep, shouldStop });
    // El entregable trae plan + spec (---SPEC---): la puerta de calidad juzga el PLAN; el spec viaja aparte.
    const parts = splitPlanSpec(r.done ? r.summary : '');
    const summary = r.done ? formatPlan(parts.plan) : '';
    if (r.done && summary && !isNumberedPlan(summary)) {
      rejected = { plan: '', spec: '', narrative: summary, steps: r.steps, error: 'el planner respondió prosa en vez de un plan numerado — reintenta /plan o reformula la tarea' };
      if (attempt < maxRetries && !shouldStop?.()) {
        taskText = `${String(task).trim()}\n\nIMPORTANT: your previous attempt replied with prose ("${summary.slice(0, 160)}…"), NOT a plan. NOTHING has been created yet. Reply ONLY with the numbered plan (1., 2., 3.) of the steps ANOTHER agent will execute — include the steps to CREATE whatever is missing.`;
        continue;
      }
      return rejected;
    }
    return {
      plan: summary,
      spec: parts.spec,
      steps: r.steps,
      interrupted: r.interrupted,
      error: r.done ? undefined : r.error
    };
  }
  return rejected;
}

// Sección de plan aprobado que se inyecta al harness del coder (required: el plan ES la tarea).
export function planSection(plan, language) {
  const f = frame(language);
  return { key: 'plan', text: `${f.planTitle}\n${String(plan).trim()}`, required: true };
}
