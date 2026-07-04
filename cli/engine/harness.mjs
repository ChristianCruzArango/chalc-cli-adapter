// cli/engine/harness.mjs — arma el prompt del agente (el `renderPrompt` que consume engine/loop.mjs).
// Separa lo FIJO y cacheable (protocolo + índice de tools + contexto de proyecto) del prompt del turno
// (tarea + historial + presupuesto de pasos + reintento). Pensado para modelos locales: instrucciones
// mínimas, una acción por turno, CCR para el volumen. Bilingüe: `language` (default = idioma configurado).
// No conoce proveedores ni interfaz.

import { estimateTokens, assembleWithinBudget } from './budgeter.mjs';
import { frame } from '../prompts/text.mjs';

// Índice COMPACTO de herramientas: nombre + una línea. Nunca vuelca esquemas completos (llenaría la ventana).
export function toolIndex(tools = {}) {
  return Object.entries(tools).map(([name, t]) => `- ${name}: ${t?.summary || ''}`).join('\n');
}

// Prompt de sistema (fijo por sesión): protocolo + tools + contexto de proyecto acotado al presupuesto.
// Lo fijo (protocolo + tools) se descuenta primero; el resto del presupuesto es para el contexto de proyecto.
export function buildSystem({ tools = {}, projectSections = [], budgetTokens = Infinity, language } = {}) {
  const f = frame(language);
  const core = `${f.protocol}\n\n${f.hTools}\n${toolIndex(tools)}`;   // protocol: .prompt.xml ya inyectado
  const remaining = budgetTokens === Infinity ? Infinity : Math.max(0, budgetTokens - estimateTokens(core));
  const project = assembleWithinBudget(projectSections, remaining);
  return project.text ? `${core}\n\n${f.hProject}\n${project.text}` : core;
}

// Historial compacto para el turno. Las observaciones ya vienen comprimidas por CCR desde el loop;
// aquí solo se limita el número de pasos visibles para no crecer sin fin.
export function formatHistory(history = [], { max = 12, language } = {}) {
  const f = frame(language);
  const recent = history.slice(-max);
  if (!recent.length) return f.noSteps;
  return recent
    .map((r) => `${f.step} ${r.step}: ${r.thought || ''}\n  ${f.action}: ${JSON.stringify(r.action)}\n  ${f.obs}: ${JSON.stringify(r.observation)}`)
    .join('\n');
}

// Crea el `renderPrompt(state)` que espera el loop. `system` se construye UNA vez (cacheable);
// el `user` se rearma cada turno con tarea + historial + presupuesto de pasos + eventual reintento.
export function createRenderPrompt({ task, tools = {}, projectSections = [], budgetTokens = 6000, historyMax = 12, language } = {}) {
  if (!task || !String(task).trim()) throw new Error('createRenderPrompt requiere una tarea.');
  const f = frame(language);
  const system = buildSystem({ tools, projectSections, budgetTokens, language });

  return ({ history = [], stepsLeft = 0, retry = '' } = {}) => ({
    system,
    user: [
      `${f.hTask}\n${String(task).trim()}`,
      `${f.hSteps}\n${formatHistory(history, { max: historyMax, language })}`,
      stepsLeft <= 0 ? f.lastStep : f.stepsLeft(stepsLeft),
      retry
    ].filter(Boolean).join('\n\n')
  });
}
