// cli/session.mjs — runner de una tarea: ata todas las piezas del CLI en un solo flujo.
//   inspectProject → secciones de contexto/reglas → tools → renderPrompt (harness) → chatImpl → runAgent.
// `chatImpl` es inyectable: con un modelo simulado se prueba el flujo COMPLETO sin Ollama ni tokens.
// No es interactivo: la shell (index.mjs) provee `approve` y `onStep`; aquí no se sabe de terminal.

import { createCcrStore } from '../lib/ccr.mjs';
import { roleConfig, roleModelLabel } from '../lib/roleconfig.mjs';
import { createAgentRegistry } from './agents/registry.mjs';
import { inspectProject, readMcpServers, mcpEnvironmentAllowlist } from './project.mjs';
import { createTools } from './tools/registry.mjs';
import { createChatImpl } from './engine/model.mjs';
import { loadSkillMetas } from './skills/loader.mjs';
import { connectMcpServers, mcpToolsForAgent, stopMcpConnections } from './mcp/astools.mjs';
import { buildProjectSections } from './sessioncontext.mjs';
import { askTurn, planTurn, reviewTurn, roleMeta } from './sessionturns.mjs';
import { userFlag } from '../lib/userpref.mjs';

export { buildProjectSections } from './sessioncontext.mjs';

// La config efectiva de un rol vive en lib/roleconfig.mjs desde que el comando `debate` (spec 014)
// pasó a ser su segundo consumidor. Se re-exporta para no romper a quien la importa desde aquí.
export { roleConfig, roleModelLabel };

// MCP: servidores tomados del PROYECTO (.mcp.json equipado), nada hardcodeado. Falla por-servidor sin
// tumbar. Nunca se invoca una tool MCP automáticamente: el nombre que anuncia un servidor no prueba
// que sea de lectura; se piden mediante la tool expuesta y pasan por la política de aprobación.
async function connectProjectMcp(project, { projectPath, cfg, mcpConnect, onMcpConnect, onMcpWarn, approveMcpServer }) {
  const mcpServers = project.equipped
    ? await readMcpServers(project.paths, process.env, { allowedEnv: mcpEnvironmentAllowlist(cfg?.cli, process.env) })
    : {};
  return connectMcpServers(mcpServers, {
    connect: mcpConnect, onConnect: onMcpConnect, onWarn: onMcpWarn,
    approveServer: approveMcpServer,
    // cwd: los servers deben operar sobre el PROYECTO, no sobre el directorio desde donde se lanzó el CLI.
    cwd: projectPath,
    // Solo una preferencia local (~/.chalc/config.json), nunca un campo del proyecto, abre esta excepción.
    allowPrivateHttp: userFlag(cfg, 'allowPrivateMcpHttp')
  });
}

// Mapa de carpetas de la arquitectura (## Folder map generado por chalc): sus roots alimentan el
// aviso determinista de ubicación en write/edit — el modelo "olvida" la arquitectura; el path no miente.
function layoutRootsOf(baseSections) {
  const archText = baseSections.find((sec) => sec.key === 'arquitectura')?.text || '';
  return [...archText.matchAll(/^###\s+`([^`\s]+)`/gm)].map((m) => m[1]);
}

// La API de la sesión para la shell y los tests.
function publicSession(s, { allow, mcpConnections }) {
  const { cfg, chatImpl, implOpts } = s;
  // Cambio de modelo EN CALIENTE (como /model): reconstruye el chatImpl con el nuevo modelo conservando
  // conversación, tools y MCP. Sin efecto (false) si chatImpl fue inyectado (tests) o el nombre está vacío.
  const setModel = (m) => {
    const name = String(m || '').trim();
    if (chatImpl || !name) return false;
    s.impl = createChatImpl({ ...(cfg || {}), model: name }, implOpts);
    return true;
  };
  return {
    project: s.project, conversation: s.conversation, language: s.language,
    // `allow`: la lista de comandos del perfil de confianza, para que el portón de verificación se
    // rija por el mismo perfil que la shell.
    allow, mcp: mcpConnections.map((c) => c.id), tools: Object.keys(s.tools),
    ask: (task, opts) => askTurn(s, task, opts),
    plan: (task, opts) => planTurn(s, task, opts),
    review: (task, opts) => reviewTurn(s, task, opts),
    // Libera los servidores MCP (mata sus procesos). La shell debe llamarlo al terminar la sesión.
    close: () => stopMcpConnections(mcpConnections),
    setModel,
    // Modelo configurado para un rol (o null = usa el base). Para que la UI muestre el modelo REAL del paso.
    modelFor: (role) => roleModelLabel(cfg, role),
    agents: s.agents
  };
}

// Espera base entre reintentos tras un error del MODELO (R33): crece con cada intento y el aborto la corta.
// Con un `chatImpl` inyectado (tests, modelos simulados) no hay a quién dar respiro: 0, salvo que se pida.
const RETRY_BACKOFF_MS = 1000;

// Sesión persistente: carga el proyecto UNA vez y mantiene conversación + store CCR entre mensajes,
// como un CLI interactivo tipo Claude Code. `ask(task)` corre el loop conservando el contexto acumulado.
// `chatImpl` es inyectable (tests sin Ollama). La aprobación se fija por-turno vía una referencia mutable,
// para crear las tools una sola vez sin acoplarlas a la terminal.
export async function createSession({
  projectPath, cfg, allow = [], numCtx, budgetTokens = 6000, maxSteps = 12, language, chatImpl,
  mcpConnect, onMcpConnect, onMcpWarn, approveMcpServer, retryDelayMs = chatImpl ? 0 : RETRY_BACKOFF_MS
} = {}) {
  const project = await inspectProject(projectPath);
  const baseSections = await buildProjectSections(project, language);
  const state = { approve: async () => false };   // sin aprobación explícita, nada se concede
  const approve = (action) => state.approve(action);
  const mcpConnections = await connectProjectMcp(project, { projectPath, cfg, mcpConnect, onMcpConnect, onMcpWarn, approveMcpServer });
  const tools = { ...createTools({ root: projectPath, approve, allow, layoutRoots: layoutRootsOf(baseSections) }), ...mcpToolsForAgent(mcpConnections, { approve, language }) };
  // maxTokens de la salida por turno: configurable en cfg.cli (default 2048 en createChatImpl).
  const implOpts = { numCtx, ...(cfg?.cli?.maxTokens ? { maxTokens: cfg.cli.maxTokens } : {}) };
  const s = {
    project, projectPath, cfg, language, baseSections, state, tools, chatImpl, implOpts, budgetTokens, maxSteps, retryDelayMs,
    skillMetas: await loadSkillMetas(project),   // una vez; la SELECCIÓN por relevancia es por-tarea
    conversation: [],
    impl: chatImpl || createChatImpl(cfg || {}, implOpts),
    // Compartido entre turnos (refs estables). Preview amplio: con 160 chars el modelo local no podía
    // actuar sin recall y re-llamaba la misma tool en bucle; con ~500 suele bastarle el resumen.
    ccr: createCcrStore({ previewChars: 500 }),
    agents: createAgentRegistry({ roles: Object.fromEntries(['planner', 'coder', 'reviewer'].map((role) => [role, roleMeta(cfg, role)])) })
  };
  return publicSession(s, { allow, mcpConnections });
}

// Atajo sin estado: una sesión + una tarea. Se mantiene para uso programático y tests.
// approveMcpServer: sin él no arranca ningún MCP del proyecto (V-08); quien los necesite lo pasa.
// La sesión se cierra SIEMPRE al terminar (R33): con un aprobador que acepta, los servidores MCP quedaban vivos.
export async function runTask({ projectPath, cfg, task, approve, approveMcpServer, mcpConnect, allow, numCtx, budgetTokens, maxSteps, language, onStep, chatImpl } = {}) {
  if (!task || !String(task).trim()) throw new Error('runTask requiere una tarea.');
  const session = await createSession({ projectPath, cfg, allow, numCtx, budgetTokens, maxSteps, language, chatImpl, approveMcpServer, mcpConnect });
  try {
    const result = await session.ask(task, { approve, onStep });
    return { project: session.project, result };
  } finally {
    await session.close();
  }
}
