// cli/mcp/client.mjs — cliente MCP sobre stdio, nativo y sin dependencias. Levanta el servidor MCP (el
// comando/args/env que el PROYECTO configuró) y habla JSON-RPC 2.0 por líneas (transporte stdio de MCP:
// un objeto JSON por línea, sin cabeceras). Hace el handshake initialize/initialized y expone tools/list y
// tools/call. Nada hardcodeado: la config viene del .mcp.json equipado.

import { spawn } from 'node:child_process';
import { createJsonRpc } from './jsonrpc.mjs';
import { childEnv } from '../../lib/childenv.mjs';
import { killTree, windowsCommand } from '../../lib/proc.mjs';
import { CLIENT_INFO, MCP_REQUEST_TIMEOUT_MS, MCP_TOOL_TIMEOUT_MS } from './clientinfo.mjs';
import { t } from '../../lib/i18n.mjs';

const PROTOCOL_VERSION = '2024-11-05';
// Tope de una línea JSON-RPC sin terminar. Un servidor que nunca envía `\n` hacía crecer el buffer
// sin límite hasta agotar la memoria del CLI.
const MAX_LINE_BYTES = 8 * 1024 * 1024;

// Lanza el servidor MCP con stdio en tubería. En Windows, npx/npm/uvx son .cmd y spawn directo da
// ENOENT: se lanza vía `cmd.exe /d /s /c "<línea>"` con la línea construida a mano (ver lib/proc.mjs).
function spawnServer({ command, args, env, cwd }) {
  const win = process.platform === 'win32' ? windowsCommand(command, args, { allowExpansion: true }) : null;
  return spawn(win ? win.file : command, win ? win.args : args, {
    cwd,
    // Sin las credenciales del usuario: un servidor que necesite una la recibe explícita en su `env`.
    env: childEnv(env || {}),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    ...(win ? { windowsVerbatimArguments: true } : {})
  });
}

// Lector del stdout del servidor: parte en líneas JSON y se las pasa al dispatcher. Una línea sin fin
// que supera el tope cierra la conexión y mata al servidor.
function lineReader(child, rpc) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    if (buffer.length > MAX_LINE_BYTES && buffer.indexOf('\n') < 0) {
      buffer = '';
      rpc.close(new Error(t('mcpLineTooLong', MAX_LINE_BYTES)));
      try { child.kill('SIGKILL'); } catch { /* ya terminó */ }
      return;
    }
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try { rpc.handle(JSON.parse(line)); } catch { /* línea no-JSON (log del server): se ignora */ }
    }
  };
}


export function createStdioClient({ command, args = [], env, cwd, timeoutMs = MCP_REQUEST_TIMEOUT_MS, onStderr } = {}) {
  if (!command) throw new Error(t('mcpNoCommand'));
  let child = null;
  let rpc = null;

  const start = async () => {
    child = spawnServer({ command, args, env, cwd });
    rpc = createJsonRpc({ send: (m) => child.stdin.write(JSON.stringify(m) + '\n'), timeoutMs });

    child.stdout.on('data', lineReader(child, rpc));
    if (onStderr) child.stderr.on('data', (d) => onStderr(d.toString()));
    // Sin este listener, un write tras la muerte del server (EPIPE) sería una excepción no capturada
    // que tumba todo el CLI; con él, el request pendiente se rechaza y el loop sigue.
    child.stdin.on('error', (e) => rpc.close(e));
    child.on('error', (e) => rpc.close(e));
    child.on('exit', (code) => rpc.close(new Error(t('mcpServerExited', code))));

    await rpc.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
    rpc.notify('notifications/initialized', {});
  };

  return {
    start,
    async listTools() {
      const r = await rpc.request('tools/list', {});
      return r?.tools || [];
    },
    async callTool(name, args) {
      // Timeout largo: un tool MCP puede ejecutar generadores/CLIs lentos (ng generate, migraciones…).
      return rpc.request('tools/call', { name, arguments: args || {} }, { timeoutMs: MCP_TOOL_TIMEOUT_MS });
    },
    async stop() {
      try { rpc?.close(); } catch { /* ya cerrado */ }
      if (child && !child.killed) killTree(child);
    }
  };
}
