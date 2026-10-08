// cli/sessionturns.mjs — los turnos de una sesión: plan (líder), review (revisor) y ask (el rol que
// ejecuta). Trabajan sobre el objeto de sesión `s` que arma createSession: proyecto, config, tools,
// CCR, conversación, registro de agentes y el modelo vigente.

import { join } from 'node:path';
import { roleConfig, roleModelLabel } from '../lib/roleconfig.mjs';
import { createRenderPrompt } from './engine/harness.mjs';
import { frame } from './prompts/text.mjs';
import { createChatImpl, isOllama } from './engine/model.mjs';
import { runAgent } from './engine/loop.mjs';
import { buildSkillSections, relevantBlocks } from './skills/loader.mjs';
import { runPlanner, planSection } from './engine/plan.mjs';
import { runReviewer, collectChanges, touchedPaths } from './engine/review.mjs';
// El MISMO módulo que lee el portón. Escribir el registro con una segunda implementación del formato
// sería garantizar que las dos se desincronizan — es el criterio que ya aplica `lib/verify-boundaries`
// al re-exportar el linter del portón en vez de copiarlo.
import { recordTouched } from '../catalog/gate/lib/touched.mjs';
import { specInfo, loadPlan } from './engine/planfile.mjs';
import { conversationSection, readSection } from './sessioncontext.mjs';

// Modelo por ROL (cli.roles.planner|coder|reviewer en la config): cada rol puede usar un modelo distinto
// o incluso OTRO PROVEEDOR (líder/revisor en la nube + coder local). Fallback: el impl único de la sesión.
// Con chatImpl inyectado (tests) los roles usan el mismo impl — el guionizado cubre todo el flujo.
function roleImpl(s, role) {
  const rc = roleConfig(s.cfg, role);
  if (s.chatImpl || !rc) return s.impl;
  return createChatImpl(rc, s.implOpts);
}

// Modelo y proveedor de un rol, para la UI y el registro de agentes.
export function roleMeta(cfg, role) {
  const rc = roleConfig(cfg, role) || cfg || {};
  return { model: roleModelLabel(cfg, role) || rc.model || cfg?.model || '', provider: rc.provider || cfg?.provider || '' };
}

// Presupuesto de contexto por ROL: un rol configurado en un proveedor CLOUD (objeto {provider…} no
// Ollama) recibe presupuesto AMPLIO — su ventana de 100-200k tokens se paga justamente para que lea
// TODAS las skills y dé órdenes precisas; recortárselas al presupuesto local (tallado para el num_ctx
// de un modelo en CPU) desperdicia lo contratado. Roles locales o sin configurar conservan el ajustado.
function budgetFor(s, role) {
  const m = s.cfg?.cli?.roles?.[role];
  if (m && typeof m === 'object' && m.provider && !isOllama(m)) return s.cfg?.cli?.cloudBudgetTokens || 24000;
  return s.budgetTokens;
}

// Secciones del harness para un turno: base + skills relevantes a la tarea + conversación previa.
// focus=true (pasos de un plan): ENRUTAMIENTO de contexto por código — al coder de un paso acotado
// viaja solo lo que ese paso necesita: sin README (orientación general, no de ejecución) y con las
// best practices recortadas a sus bloques `##` relevantes (sin pérdida: ante la duda, completas).
// El planner y el reviewer conservan SIEMPRE el contexto íntegro: planear y juzgar requieren el todo.
async function sectionsFor(s, task, { focus = false } = {}) {
  const skillSections = await buildSkillSections(s.skillMetas, { task, stacks: s.project.stacks, language: s.language });
  const convo = conversationSection(s.conversation, { language: s.language });
  const base = !focus ? s.baseSections : s.baseSections
    .filter((sec) => sec.key !== 'readme')
    .map((sec) => sec.key === 'best-practices' ? { ...sec, text: relevantBlocks(sec.text, task) } : sec);
  return [...base, ...skillSections, ...(convo ? [convo] : [])];
}

// Un turno queda registrado como run de su rol: `fn(id, onStep)` lo ejecuta (y lo cierra con
// agents.finish); si lanza, el run queda fallido y el error sigue su camino.
async function tracked(s, role, task, onStep, fn) {
  const id = s.agents.begin({ role, task, ...roleMeta(s.cfg, role) });
  try {
    return await fn(id, (step) => { s.agents.step(id, step); onStep?.(step); });
  } catch (error) { s.agents.fail(id, error); throw error; }
}

const closeRun = (s, id, result) => s.agents.finish(id, { done: !result?.interrupted, interrupted: result?.interrupted, error: result?.error });

// Modo plan (F1): el rol planner explora en SOLO LECTURA y propone un plan numerado. No escribe nada;
// la shell muestra el plan y solo si el usuario lo aprueba se pasa a ask(task, { plan }).
// Si el proyecto define su PLANTILLA de spec (specs/_template/spec.md), viaja al planner como sección
// OBLIGATORIA: el spec que el líder redacta debe seguir el formato DEL PROYECTO (EARS, R-ids…), no el
// que a él se le ocurra. Solo el planner la recibe: el coder consume specs, nunca los escribe.
export async function planTurn(s, task, { onStep, shouldStop } = {}) {
  if (!task || !String(task).trim()) throw new Error('plan requiere una tarea.');
  return tracked(s, 'planner', task, onStep, async (id, step) => {
    const sections = await sectionsFor(s, task);
    const tpl = await readSection(join(s.project.projectPath, 'specs', '_template', 'spec.md'), 'spec-template', frame(s.language).specTemplateTitle, true, 2500);
    if (tpl) sections.push(tpl);
    const result = await runPlanner({
      chatImpl: roleImpl(s, 'planner'), tools: s.tools, projectSections: sections,
      task, budgetTokens: budgetFor(s, 'planner'), language: s.language, onStep: step, shouldStop, ccr: s.ccr
    });
    closeRun(s, id, result);
    return result;
  });
}

// El revisor NO juzga desde cero: además de las skills relevantes, recibe como secciones OBLIGATORIAS
// el SPEC aprobado (el CONTRATO — requisitos R1… y criterios de aceptación que guiaron al
// desarrollador) y el PLAN DE EJECUCIÓN vigente (qué se ordenó y qué marcó el harness). Con contrato
// + plan el veredicto es trazable: "incumple R2" / "la tarea 3 quedó a medias", en vez de re-derivar
// la intención desde el texto de la tarea.
// Cuánto del spec viaja al revisor: los requisitos caben de sobra; un spec enorme no se le cuela entero.
const SPEC_REVIEW_CHARS = 4000;

async function reviewSections(s, task) {
  const sections = await sectionsFor(s, task);
  const f = frame(s.language);
  const spec = specInfo(s.projectPath);
  if (spec.text) {
    const text = spec.text.length > SPEC_REVIEW_CHARS ? spec.text.slice(0, SPEC_REVIEW_CHARS) + '\n[…truncated]' : spec.text;
    sections.push({ key: 'spec', required: true, text: `### ${f.specReviewTitle}\n${text}` });
  }
  const saved = loadPlan(s.projectPath);
  if (saved?.items?.length) {
    const planText = saved.items.map((it) => `- ${it.done ? '[x]' : '[ ]'} ${it.text}`).join('\n');
    sections.push({ key: 'plan', required: true, text: `### ${f.planReviewTitle}\nGoal: ${saved.goal}\n${planText}` });
  }
  return sections;
}

// Modo review (F2): el rol reviewer revisa los CAMBIOS de las rutas dadas (git diff acotado; contenido
// para archivos nuevos) en solo lectura. Devuelve { ok, findings } — la shell decide si se corrige.
export async function reviewTurn(s, task, { paths = [], onStep, shouldStop } = {}) {
  if (!task || !String(task).trim()) throw new Error('review requiere la tarea revisada.');
  return tracked(s, 'reviewer', task, onStep, async (id, step) => {
    const changes = await collectChanges(s.projectPath, paths);
    if (!changes) { s.agents.finish(id, { done: true }); return { ok: true, findings: '', steps: [], empty: true }; }
    const result = await runReviewer({
      chatImpl: roleImpl(s, 'reviewer'), tools: s.tools, projectSections: await reviewSections(s, task),
      task, changes, budgetTokens: budgetFor(s, 'reviewer'), language: s.language, onStep: step, shouldStop, ccr: s.ccr
    });
    closeRun(s, id, result);
    return result;
  });
}

// plan (opcional): plan aprobado por el usuario — entra como sección requerida del harness y el rol
// pasa a 'coder' (mismo impl salvo que cli.roles.coder fije otro modelo).
// focus (opcional): turno de PASO acotado — contexto enrutado (ver sectionsFor).
// role (opcional, default 'coder'): rol que EJECUTA el turno. El orquestador lo usa para enrutar
// los pasos de ESPECIFICACIÓN al planner (líder): el desarrollador solo recibe órdenes y nunca
// redacta los documentos que gobiernan su propio trabajo. El rol define modelo Y presupuesto.
export async function askTurn(s, task, { approve, onStep, shouldStop, plan: approvedPlan, focus = false, role = 'coder' } = {}) {
  if (!task || !String(task).trim()) throw new Error('ask requiere una tarea.');
  return tracked(s, role, task, onStep, async (id, step) => {
    // Sin `approve` explícito se DENIEGA: quien usa la sesión por programa y olvida pasarlo no debe
    // conceder escrituras ni comandos sin que nadie los vea (antes el defecto aprobaba todo).
    s.state.approve = approve || (async () => false);
    const sections = await sectionsFor(s, task, { focus });
    if (approvedPlan) sections.push(planSection(approvedPlan, s.language));
    const renderPrompt = createRenderPrompt({ task, tools: s.tools, projectSections: sections, budgetTokens: budgetFor(s, role), language: s.language });
    const result = await runAgent({ chatImpl: roleImpl(s, role), tools: s.tools, renderPrompt, ccr: s.ccr, maxSteps: s.maxSteps, onStep: step, shouldStop });
    s.conversation.push({ role: 'user', content: String(task).trim() });
    s.conversation.push({ role: 'assistant', content: result.done ? (result.summary || '(sin resumen)') : (result.error || 'sin resultado') });
    // Lo que este turno escribió queda anotado para la tarea (spec 013, R10). Se anota AQUÍ y no
    // en cada sitio que llama a `ask` porque los cuatro caminos —turno suelto, paso de plan,
    // reintento, modo pantalla— pasan por esta función: una omisión en cualquiera de ellos dejaría
    // el registro incompleto, y un registro incompleto es peor que ninguno (acota de menos, y
    // acotar de menos aprueba).
    //
    // El turno no se interrumpe si falla: sin registro el alcance cae al diff, que revisa de más.
    if (s.projectPath) await recordTouched(s.projectPath, touchedPaths(result));
    s.agents.finish(id, result);
    return result;
  });
}
