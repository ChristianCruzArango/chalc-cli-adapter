// cli/mcp/astools.mjs — convierte los servidores MCP EQUIPADOS del proyecto en herramientas del agente.
// Índice compacto: cada tool MCP es `mcp__<server>__<tool>` con summary = su descripción (una línea); el
// esquema COMPLETO no va al prompt (llenaría la ventana del modelo local), se pide con la meta-tool `describe`.
// Toda llamada MCP pide aprobación (puede tener efectos: escribir en BD, etc.). `connect` es inyectable (tests).

import { createStdioClient } from './client.mjs';
import { createHttpClient } from './httpclient.mjs';
import { frame } from '../prompts/text.mjs';
import { redactSensitiveText } from '../../lib/redact.mjs';

// Conecta los servidores del proyecto (config { id: {command,args,env} }). Falla por-servidor sin tumbar la
// sesión: si uno no arranca (o tarda más que timeoutMs), se avisa y se sigue con los demás.
// onConnect(id) se dispara antes de cada intento (para mostrar progreso: npx puede tardar en arrancar).
// approveServer(id, cfg): el .mcp.json viene DEL PROYECTO — abrir un repo ajeno no debe ejecutar sus comandos
// sin que el usuario los vea y apruebe. Si devuelve false, ese servidor se omite.
// cwd: directorio de trabajo por defecto para los servers (el del proyecto); la config propia puede sobreescribirlo.
export async function connectMcpServers(servers = {}, { connect, onConnect, onWarn, approveServer, cwd, timeoutMs = 12000, allowPrivateHttp = false } = {}) {
  // Transporte por config: { url } → servidor REMOTO (Streamable HTTP); { command } → proceso local (stdio).
  // allowPrivateHttp llega solo desde la configuración local del usuario; un .mcp.json nunca puede habilitarlo.
  const make = connect || ((cfg) => (cfg.url
    ? createHttpClient({ timeoutMs, ...cfg, allowPrivate: allowPrivateHttp })
    : createStdioClient({ timeoutMs, cwd, ...cfg })));
  const connections = [];
  for (const [id, cfg] of Object.entries(servers)) {
    if (approveServer && !(await approveServer(id, cfg))) {
      if (onWarn) onWarn(id, 'omitido: el usuario no aprobó ejecutar este servidor');
      continue;
    }
    if (onConnect) onConnect(id);
    let client = null;
    try {
      client = make(cfg, id);
      await client.start?.();
      const tools = await client.listTools();
      connections.push({ id, client, tools });
    } catch (e) {
      // Sin este stop, un handshake fallido (timeout de initialize) dejaría vivo el proceso ya spawneado.
      try { await client?.stop?.(); } catch { /* ya terminó */ }
      if (onWarn) onWarn(id, e?.message || String(e));
    }
  }
  return connections;
}

// Desenvuelve el resultado MCP ({content:[{type:'text',text}…], isError}) a una observación plana para el
// modelo local: solo el texto útil, sin el envoltorio del protocolo (menos tokens, más fácil de razonar).
export function unwrapMcpResult(result) {
  const parts = (result?.content || [])
    .map((b) => (b?.type === 'text' ? b.text : `[${b?.type || 'bloque'} no textual]`))
    .filter(Boolean);
  const text = redactSensitiveText(parts.join('\n').trim());
  if (result?.isError) return { error: text || 'el tool MCP reportó un error' };
  return text ? { text } : { ok: true };
}

// ¿El error habla de argumentos inválidos? (zod/JSON-Schema del server: invalid_type, required, expected…)
const ARG_ERROR = /invalid|validation|expected|required|argument/i;
// Los servers devuelven volcados de validación ENORMES (JSON de zod multilínea): compactar a una línea
// corta — el modelo local no necesita el volcado, necesita la pista de usar describe.
const compactError = (t) => String(t).replace(/\s+/g, ' ').trim().slice(0, 280);

// Herramientas del agente a partir de las conexiones. Incluye la meta-tool `describe` si hay alguna tool MCP.
export function mcpToolsForAgent(connections = [], { approve = async () => true, language } = {}) {
  const tools = {};
  const schemas = {};
  const f = frame(language);

  for (const { id, client, tools: list } of connections) {
    for (const t of list || []) {
      const name = `mcp__${id}__${t.name}`;
      schemas[name] = t.inputSchema || {};
      // Los args van en el ÍNDICE (con * los obligatorios): sin esto, el modelo local llama a ciegas,
      // el server le devuelve un error de validación y se pierde un paso (o entra en bucle).
      const props = Object.keys(t.inputSchema?.properties || {});
      const req = new Set(t.inputSchema?.required || []);
      const argsNote = props.length ? ` · args: ${props.slice(0, 6).map((p) => (req.has(p) ? `${p}*` : p)).join(', ')}` : '';
      tools[name] = {
        argHints: props,   // para que el loop desambigüe nombres truncados por las claves de args
        summary: `[MCP ${id}] ${t.description || t.name}${argsNote}`,
        run: async (args) => {
          if (!(await approve({ tool: name, args }))) return { error: 'MCP action not approved by the user' };
          let out;
          try {
            out = unwrapMcpResult(await client.callTool(t.name, args));
          } catch (e) {
            out = { error: redactSensitiveText(e?.message || String(e)) };   // JSON-RPC error (p. ej. -32602 args inválidos)
          }
          if (out.error) {
            out.error = compactError(out.error);
            // Pista accionable: sin ella, el modelo repite la misma llamada mala hasta el cortacircuito.
            if (ARG_ERROR.test(out.error)) out.hint = f.mcpArgsHint(name);
          }
          return out;
        }
      };
    }
  }

  if (Object.keys(schemas).length) {
    tools.describe = {
      summary: frame(language).describeSummary,
      run: async ({ tool } = {}) => {
        if (tool in schemas) return { tool, schema: schemas[tool] };
        // Nombre incompleto (p. ej. solo "mcp__angular-cli"): listar las tools reales de ese prefijo
        // es más útil que un error seco — el modelo elige y repite describe con el nombre completo.
        const cands = tool ? Object.keys(schemas).filter((n) => n.startsWith(String(tool))) : [];
        if (cands.length) return { tool, error: `incomplete name: ${tool}`, tools: cands };
        return { error: `no schema for: ${tool}` };
      }
    };
  }

  return tools;
}

// Detiene todas las conexiones (mata los procesos de los servidores). Best-effort.
export async function stopMcpConnections(connections = []) {
  for (const c of connections) {
    try { await c.client?.stop?.(); } catch { /* ya terminó */ }
  }
}
