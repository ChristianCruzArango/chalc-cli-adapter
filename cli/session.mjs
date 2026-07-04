// cli/session.mjs — runner de una tarea: ata todas las piezas del CLI en un solo flujo.
//   inspectProject → secciones de contexto/reglas → tools → renderPrompt (harness) → chatImpl → runAgent.
// `chatImpl` es inyectable: con un modelo simulado se prueba el flujo COMPLETO sin Ollama ni tokens.
// No es interactivo: la shell (index.mjs) provee `approve` y `onStep`; aquí no se sabe de terminal.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createCcrStore } from '../lib/ccr.mjs';
import { inspectProject, readMcpServers, projectTree } from './project.mjs';
import { createTools } from './tools/registry.mjs';
import { createRenderPrompt } from './engine/harness.mjs';
import { frame } from './prompts/text.mjs';
import { createChatImpl, isOllama } from './engine/model.mjs';
import { runAgent } from './engine/loop.mjs';
import { loadSkillMetas, buildSkillSections, relevantBlocks } from './skills/loader.mjs';
import { connectMcpServers, mcpToolsForAgent, stopMcpConnections, unwrapMcpResult } from './mcp/astools.mjs';
import { runPlanner, planSection } from './engine/plan.mjs';
import { runReviewer, collectChanges } from './engine/review.mjs';
import { specInfo, loadPlan } from './engine/planfile.mjs';

// Cómo se GENERA código en cada stack: la instrucción concreta que evita que el modelo invente
// "tools de generación" MCP que no existen. Solo stacks con generador oficial de CLI.
const STACK_GENERATORS = {
  angular: 'ng generate <schematic> <nombre>',
  nestjs: 'nest generate <schematic> <nombre>',
  dotnet: 'dotnet new <plantilla>',
  flutter: 'flutter create <nombre>'
};

// Orientación mínima del proyecto (siempre incluida): lo detectado por inspectProject en pocas líneas.
function contextSection(project, language) {
  const f = frame(language);
  const lines = [f.ctxHeader];
  if (project.equipped) {
    if (project.stacks?.length) lines.push(`- ${f.ctxStacks}: ${project.stacks.join(', ')}`);
    const gen = (project.stacks || []).map((s) => STACK_GENERATORS[s]).filter(Boolean);
    if (gen.length) lines.push(f.ctxGenerate(gen.join(' · ')));
    if (project.detected.skills.length) lines.push(`- ${f.ctxSkills}: ${project.detected.skills.join(', ')}`);
    if (project.detected.mcpServers.length) lines.push(`- ${f.ctxMcp}: ${project.detected.mcpServers.join(', ')}`);
  }
  if (project.git?.isRepo) lines.push(f.ctxGit(project.git.branch, project.git.clean));
  return { key: 'contexto', text: lines.join('\n'), required: true };
}

// key: identificador estable (independiente del idioma); title: encabezado visible (inglés: va al modelo).
// maxChars acota archivos largos (un README de 30k no debe desplazar al resto del contexto).
async function readSection(file, key, title, required, maxChars = Infinity) {
  if (!file) return null;
  try {
    let text = (await readFile(file, 'utf8')).trim();
    if (!text) return null;
    if (text.length > maxChars) text = text.slice(0, maxChars) + '\n[…truncated]';
    return { key, text: `### ${title}\n${text}`, required };
  } catch {
    return null;
  }
}

// README internos de carpetas (src/app/features/README.md, core, shared…): documentan la convención
// EXACTAMENTE donde vive, y deben llegar al contexto aunque al modelo no se le ocurra explorarlos.
// Recolección determinista y acotada (hasta 8 archivos, cap por archivo); el de la raíz va aparte.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'out', 'build', 'target', 'vendor']);
const MAX_FOLDER_NOTES = 8;
async function folderNotesSection(projectPath, title) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > 4 || found.length >= MAX_FOLDER_NOTES) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_FOLDER_NOTES) return;
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(join(dir, e.name), depth + 1);
      else if (e.isFile() && e.name === 'README.md' && depth > 0) found.push(join(dir, e.name));
    }
  }
  await walk(projectPath, 0);
  const parts = [];
  for (const file of found) {
    try {
      let text = (await readFile(file, 'utf8')).trim();
      if (!text) continue;
      if (text.length > 1500) text = text.slice(0, 1500) + '\n[…truncated]';
      parts.push(`#### ${relative(projectPath, file).replace(/\\/g, '/')}\n${text}`);
    } catch { /* ilegible: se omite */ }
  }
  if (!parts.length) return null;
  return { key: 'folder-notes', required: false, text: `### ${title}\n${parts.join('\n\n')}` };
}

// Secciones de proyecto para el harness, con la PRIORIDAD que pidió el usuario: primero los documentos
// RECTORES que el propio proyecto mantiene (instrucciones CLAUDE.md/equivalente + constitución +
// arquitectura + README de carpetas) — son el mapa; las skills se cargan aparte y SELECTIVAS (por
// relevancia a la tarea), no por volumen. El budgeter decide qué opcionales caben.
export async function buildProjectSections(project, language) {
  const f = frame(language);
  const sections = [contextSection(project, language)];
  // Árbol REAL del proyecto (requerido): sin él, los modelos locales adivinan rutas que no existen.
  const tree = await projectTree(project.projectPath);
  if (tree) sections.push({ key: 'tree', required: true, text: `### project tree (the REAL files — do not guess paths)\n${tree}` });
  // Instrucciones del proyecto (CLAUDE.md / copilot-instructions.md / GEMINI.md según target): el
  // documento rector que el usuario mantiene para SUS agentes — obligatorio, no opcional.
  if (project.equipped && project.paths.rulesFile) {
    const rules = await readSection(project.paths.rulesFile, 'instrucciones', f.rulesTitle, true, 3000);
    if (rules) sections.push(rules);
  }
  // README: la orientación que el propio proyecto trae — se lee SIEMPRE que exista (equipado o no).
  const readme = await readSection(join(project.projectPath, 'README.md'), 'readme', f.readmeTitle, false, 2500);
  if (readme) sections.push(readme);
  if (project.equipped) {
    for (const s of [
      await readSection(project.paths.constitution, 'constitución', f.constitutionTitle, true),
      await readSection(project.paths.architecture, 'arquitectura', f.architectureTitle, false)
    ]) if (s) sections.push(s);
  }
  const notes = await folderNotesSection(project.projectPath, f.folderNotesTitle);
  if (notes) sections.push(notes);
  return sections;
}

// Buenas prácticas del framework: si un MCP conectado expone una tool de "best practices" (p. ej.
// angular-cli.get_best_practices), el ORQUESTADOR la consulta UNA vez al abrir la sesión y la inyecta
// al contexto de los tres roles. Dejarlo a criterio del modelo es lotería — y sin esto genera patrones
// obsoletos (NgModules en Angular standalone, etc.). Solo tools de lectura evidente; best-effort.
const MAX_BEST_PRACTICES = 3000;
async function fetchBestPractices(connections, stacks = []) {
  // Solo del MCP DEL stack del proyecto (angular-cli ↔ angular): cargar las prácticas de un framework
  // en un proyecto de otro stack (o sin stack) contaminaría el contexto sin aportar nada.
  if (!stacks.length) return null;
  const ofStack = connections.filter(({ id }) =>
    stacks.some((s) => String(id).toLowerCase().includes(String(s).toLowerCase())));
  for (const { id, client, tools } of ofStack) {
    const t = (tools || []).find((x) => /best[_-]?practices|instructions/i.test(x?.name || ''));
    if (!t) continue;
    try {
      const out = unwrapMcpResult(await client.callTool(t.name, {}));
      if (out.text) {
        const text = out.text.length > MAX_BEST_PRACTICES ? out.text.slice(0, MAX_BEST_PRACTICES) + '\n[…truncated]' : out.text;
        return { key: 'best-practices', required: false, text: `### framework best practices (from MCP ${id} — FOLLOW THESE over your own habits)\n${text}` };
      }
    } catch { /* best-effort: sin buenas prácticas la sesión sigue */ }
  }
  return null;
}

// Conversación previa (resúmenes user↔agente) como sección OPCIONAL del harness. Lleva CONTEXTO entre turnos
// sin arrastrar cada observación: para modelos locales, resumir es lo que evita llenar la ventana. Se acota a
// los últimos turnos y el budgeter decide si cabe. Devuelve null si aún no hay conversación.
function conversationSection(conversation, { max = 6, language } = {}) {
  const recent = conversation.slice(-max);
  if (!recent.length) return null;
  const f = frame(language);
  const text = recent.map((m) => `${m.role === 'user' ? f.roleUser : f.roleAgent}: ${m.content}`).join('\n');
  return { key: 'conversación', text: `${f.convHeader}\n${text}`, required: false };
}

// Config efectiva de un ROL (cli.roles.planner|coder|reviewer). Dos formas en la config:
//   - string: otro MODELO del mismo proveedor de la sesión (comportamiento clásico).
//   - objeto {provider, model, apiKey?, baseURL?}: el rol corre en OTRO proveedor (p. ej. planner en
//     OpenRouter con Opus, reviewer en OpenAI, coder en Ollama local). La config del rol se arma SIN
//     heredar apiKey/baseURL/apiVersion del proveedor base — cruzar credenciales entre servicios
//     rompe la llamada (una key de OpenRouter no abre OpenAI). cli.* sí se hereda (timeouts, think…).
// Devuelve null si el rol no está configurado o el objeto está incompleto → usa el impl base.
export function roleConfig(cfg, role) {
  const m = cfg?.cli?.roles?.[role];
  if (!m) return null;
  if (typeof m === 'string') return { ...cfg, model: m };
  if (!m.provider || !m.model) return null;
  const { baseURL: _b, apiKey: _k, apiVersion: _v, ...base } = cfg || {};
  return { ...base, ...m };
}

// Etiqueta del modelo de un rol para la UI ("pensando con X…"): el nombre a secas si es del mismo
// proveedor, "modelo (proveedor)" si el rol corre en otro. null = rol sin configurar (modelo base).
export function roleModelLabel(cfg, role) {
  const m = cfg?.cli?.roles?.[role];
  if (!m) return null;
  if (typeof m === 'string') return m;
  return m.provider && m.model ? `${m.model} (${m.provider})` : null;
}

// Sesión persistente: carga el proyecto UNA vez y mantiene conversación + store CCR entre mensajes,
// como un CLI interactivo tipo Claude Code. `ask(task)` corre el loop conservando el contexto acumulado.
// `chatImpl` es inyectable (tests sin Ollama). La aprobación se fija por-turno vía una referencia mutable,
// para crear las tools una sola vez sin acoplarlas a la terminal.
export async function createSession({
  projectPath, cfg, allow = [], numCtx, budgetTokens = 6000, maxSteps = 12, language, chatImpl,
  mcpConnect, onMcpConnect, onMcpWarn, approveMcpServer
} = {}) {
  const project = await inspectProject(projectPath);
  const baseSections = await buildProjectSections(project, language);
  const skillMetas = await loadSkillMetas(project);   // una vez; la SELECCIÓN por relevancia es por-tarea
  const conversation = [];
  const state = { approve: async () => true };
  const approve = (action) => state.approve(action);

  // MCP: servidores tomados del PROYECTO (.mcp.json equipado), nada hardcodeado. Falla por-servidor sin tumbar.
  const mcpServers = project.equipped ? await readMcpServers(project.paths) : {};
  // cwd: los servers deben operar sobre el PROYECTO, no sobre el directorio desde donde se lanzó el CLI.
  const mcpConnections = await connectMcpServers(mcpServers, {
    connect: mcpConnect, onConnect: onMcpConnect, onWarn: onMcpWarn,
    approveServer: approveMcpServer, cwd: projectPath
  });
  const mcpTools = mcpToolsForAgent(mcpConnections, { approve, language });

  // Buenas prácticas del framework al contexto BASE: las ven el planner, el coder y el reviewer.
  const bestPractices = await fetchBestPractices(mcpConnections, project.stacks || []);
  if (bestPractices) baseSections.push(bestPractices);

  // Mapa de carpetas de la arquitectura (## Folder map generado por chalc): sus roots alimentan el
  // aviso determinista de ubicación en write/edit — el modelo "olvida" la arquitectura; el path no miente.
  const archText = baseSections.find((s) => s.key === 'arquitectura')?.text || '';
  const layoutRoots = [...archText.matchAll(/^###\s+`([^`\s]+)`/gm)].map((m) => m[1]);

  const tools = { ...createTools({ root: projectPath, approve, allow, layoutRoots }), ...mcpTools };
  // maxTokens de la salida por turno: configurable en cfg.cli (default 2048 en createChatImpl).
  const implOpts = { numCtx, ...(cfg?.cli?.maxTokens ? { maxTokens: cfg.cli.maxTokens } : {}) };
  let impl = chatImpl || createChatImpl(cfg || {}, implOpts);

  // Cambio de modelo EN CALIENTE (como /model): reconstruye el chatImpl con el nuevo modelo conservando
  // conversación, tools y MCP. Sin efecto (false) si chatImpl fue inyectado (tests) o el nombre está vacío.
  const setModel = (m) => {
    const name = String(m || '').trim();
    if (chatImpl || !name) return false;
    impl = createChatImpl({ ...(cfg || {}), model: name }, implOpts);
    return true;
  };

  // Modelo por ROL (cli.roles.planner|coder|reviewer en la config): cada rol puede usar un modelo distinto
  // o incluso OTRO PROVEEDOR (líder/revisor en la nube + coder local). Fallback: el impl único de la sesión.
  // Con chatImpl inyectado (tests) los roles usan el mismo impl — el guionizado cubre todo el flujo.
  const roleImpl = (role) => {
    const rc = roleConfig(cfg, role);
    if (chatImpl || !rc) return impl;
    return createChatImpl(rc, implOpts);
  };

  // Modelo configurado para un rol (o null = usa el base). Para que la UI muestre el modelo REAL del paso.
  const modelFor = (role) => roleModelLabel(cfg, role);

  // Presupuesto de contexto por ROL: un rol configurado en un proveedor CLOUD (objeto {provider…} no
  // Ollama) recibe presupuesto AMPLIO — su ventana de 100-200k tokens se paga justamente para que lea
  // TODAS las skills y dé órdenes precisas; recortárselas al presupuesto local (tallado para el num_ctx
  // de un modelo en CPU) desperdicia lo contratado. Roles locales o sin configurar conservan el ajustado.
  const budgetFor = (role) => {
    const m = cfg?.cli?.roles?.[role];
    if (m && typeof m === 'object' && m.provider && !isOllama(m)) return cfg?.cli?.cloudBudgetTokens || 24000;
    return budgetTokens;
  };

  // Secciones del harness para un turno: base + skills relevantes a la tarea + conversación previa.
  // focus=true (pasos de un plan): ENRUTAMIENTO de contexto por código — al coder de un paso acotado
  // viaja solo lo que ese paso necesita: sin README (orientación general, no de ejecución) y con las
  // best practices recortadas a sus bloques `##` relevantes (sin pérdida: ante la duda, completas).
  // El planner y el reviewer conservan SIEMPRE el contexto íntegro: planear y juzgar requieren el todo.
  async function sectionsFor(task, { focus = false } = {}) {
    const skillSections = await buildSkillSections(skillMetas, { task, stacks: project.stacks, language });
    const convo = conversationSection(conversation, { language });
    const base = !focus ? baseSections : baseSections
      .filter((s) => s.key !== 'readme')
      .map((s) => s.key === 'best-practices' ? { ...s, text: relevantBlocks(s.text, task) } : s);
    return [...base, ...skillSections, ...(convo ? [convo] : [])];
  }

  // Modo plan (F1): el rol planner explora en SOLO LECTURA y propone un plan numerado. No escribe nada;
  // la shell muestra el plan y solo si el usuario lo aprueba se pasa a ask(task, { plan }).
  // Si el proyecto define su PLANTILLA de spec (specs/_template/spec.md), viaja al planner como sección
  // OBLIGATORIA: el spec que el líder redacta debe seguir el formato DEL PROYECTO (EARS, R-ids…), no el
  // que a él se le ocurra. Solo el planner la recibe: el coder consume specs, nunca los escribe.
  async function plan(task, { onStep, shouldStop } = {}) {
    if (!task || !String(task).trim()) throw new Error('plan requiere una tarea.');
    const sections = await sectionsFor(task);
    const f = frame(language);
    const tpl = await readSection(join(project.projectPath, 'specs', '_template', 'spec.md'), 'spec-template', f.specTemplateTitle, true, 2500);
    if (tpl) sections.push(tpl);
    return runPlanner({
      chatImpl: roleImpl('planner'), tools, projectSections: sections,
      task, budgetTokens: budgetFor('planner'), language, onStep, shouldStop, ccr
    });
  }
  // Compartido entre turnos (refs estables). Preview amplio: con 160 chars el modelo local no podía actuar
  // sin recall y re-llamaba la misma tool en bucle; con ~500 suele bastarle el resumen.
  const ccr = createCcrStore({ previewChars: 500 });

  // Modo review (F2): el rol reviewer revisa los CAMBIOS de las rutas dadas (git diff acotado; contenido
  // para archivos nuevos) en solo lectura. Devuelve { ok, findings } — la shell decide si se corrige.
  // El revisor NO juzga desde cero: además de las skills relevantes (van en sectionsFor), recibe como
  // secciones OBLIGATORIAS el SPEC aprobado (el CONTRATO — requisitos R1… y criterios de aceptación que
  // guiaron al desarrollador) y el PLAN DE EJECUCIÓN vigente (qué se ordenó y qué marcó el harness).
  // Con contrato + plan el veredicto es trazable: "incumple R2" / "la tarea 3 quedó a medias", en vez
  // de re-derivar la intención desde el texto de la tarea.
  async function review(task, { paths = [], onStep, shouldStop } = {}) {
    if (!task || !String(task).trim()) throw new Error('review requiere la tarea revisada.');
    const changes = await collectChanges(projectPath, paths);
    if (!changes) return { ok: true, findings: '', steps: [], empty: true };
    const sections = await sectionsFor(task);
    const f = frame(language);
    const spec = specInfo(projectPath);
    if (spec.text) {
      const text = spec.text.length > 4000 ? spec.text.slice(0, 4000) + '\n[…truncated]' : spec.text;
      sections.push({ key: 'spec', required: true, text: `### ${f.specReviewTitle}\n${text}` });
    }
    const saved = loadPlan(projectPath);
    if (saved?.items?.length) {
      const planText = saved.items.map((it) => `- ${it.done ? '[x]' : '[ ]'} ${it.text}`).join('\n');
      sections.push({ key: 'plan', required: true, text: `### ${f.planReviewTitle}\nGoal: ${saved.goal}\n${planText}` });
    }
    return runReviewer({
      chatImpl: roleImpl('reviewer'), tools, projectSections: sections,
      task, changes, budgetTokens: budgetFor('reviewer'), language, onStep, shouldStop, ccr
    });
  }

  // plan (opcional): plan aprobado por el usuario — entra como sección requerida del harness y el rol
  // pasa a 'coder' (mismo impl salvo que cli.roles.coder fije otro modelo).
  // focus (opcional): turno de PASO acotado — contexto enrutado (ver sectionsFor).
  // role (opcional, default 'coder'): rol que EJECUTA el turno. El orquestador lo usa para enrutar
  // los pasos de ESPECIFICACIÓN al planner (líder): el desarrollador solo recibe órdenes y nunca
  // redacta los documentos que gobiernan su propio trabajo. El rol define modelo Y presupuesto.
  async function ask(task, { approve, onStep, shouldStop, plan: approvedPlan, focus = false, role = 'coder' } = {}) {
    if (!task || !String(task).trim()) throw new Error('ask requiere una tarea.');
    state.approve = approve || (async () => true);
    const sections = await sectionsFor(task, { focus });
    if (approvedPlan) sections.push(planSection(approvedPlan, language));
    const renderPrompt = createRenderPrompt({ task, tools, projectSections: sections, budgetTokens: budgetFor(role), language });
    const result = await runAgent({ chatImpl: roleImpl(role), tools, renderPrompt, ccr, maxSteps, onStep, shouldStop });
    conversation.push({ role: 'user', content: String(task).trim() });
    conversation.push({ role: 'assistant', content: result.done ? (result.summary || '(sin resumen)') : (result.error || 'sin resultado') });
    return result;
  }

  // Libera los servidores MCP (mata sus procesos). La shell debe llamarlo al terminar la sesión.
  const close = () => stopMcpConnections(mcpConnections);

  return { project, conversation, language, mcp: mcpConnections.map((c) => c.id), tools: Object.keys(tools), ask, plan, review, close, setModel, modelFor };
}

// Atajo sin estado: una sesión + una tarea. Se mantiene para uso programático y tests.
export async function runTask({ projectPath, cfg, task, approve, allow, numCtx, budgetTokens, maxSteps, language, onStep, chatImpl } = {}) {
  if (!task || !String(task).trim()) throw new Error('runTask requiere una tarea.');
  const session = await createSession({ projectPath, cfg, allow, numCtx, budgetTokens, maxSteps, language, chatImpl });
  const result = await session.ask(task, { approve, onStep });
  return { project: session.project, result };
}
