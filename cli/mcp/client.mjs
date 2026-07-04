// cli/mcp/client.mjs — cliente MCP sobre stdio, nativo y sin dependencias. Levanta el servidor MCP (el
// comando/args/env que el PROYECTO configuró) y habla JSON-RPC 2.0 por líneas (transporte stdio de MCP:
// un objeto JSON por línea, sin cabeceras). Hace el handshake initialize/initialized y expone tools/list y
// tools/call. Nada hardcodeado: la config viene del .mcp.json equipado.

import { spawn } from 'node:child_process';
import { createJsonRpc } from './jsonrpc.mjs';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'chalc-cli', version: '0.1.0' };

export function createStdioClient({ command, args = [], env, cwd, timeoutMs = 15000, onStderr } = {}) {
  if (!command) throw new Error('MCP: falta "command" en la configuración del servidor.');
  let child = null;
  let rpc = null;
  let buffer = '';

  const start = async () => {
    // En Windows, npx/npm/uvx son .cmd y spawn directo da ENOENT. Se lanza vía `cmd.exe /d /s /c "<línea>"`
    // construyendo la línea COMPLETA a mano (windowsVerbatimArguments): con /s, cmd quita la primera y la
    // última comilla de la línea, así que el quoting automático de Node rompe comandos con espacios en la
    // ruta ("C:\Program Files\..."). La comilla exterior extra + quoting propio por-argumento lo resuelve.
    const isWin = process.platform === 'win32';
    const q = (s) => (/[\s"]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
    const cmd = isWin ? (process.env.ComSpec || 'cmd.exe') : command;
    const cmdArgs = isWin ? ['/d', '/s', '/c', `"${[command, ...args].map(q).join(' ')}"`] : args;
    child = spawn(cmd, cmdArgs, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...(isWin ? { windowsVerbatimArguments: true } : {})
    });
    rpc = createJsonRpc({ send: (m) => child.stdin.write(JSON.stringify(m) + '\n'), timeoutMs });

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try { rpc.handle(JSON.parse(line)); } catch { /* línea no-JSON (log del server): se ignora */ }
      }
    });
    if (onStderr) child.stderr.on('data', (d) => onStderr(d.toString()));
    // Sin este listener, un write tras la muerte del server (EPIPE) sería una excepción no capturada
    // que tumba todo el CLI; con él, el request pendiente se rechaza y el loop sigue.
    child.stdin.on('error', (e) => rpc.close(e));
    child.on('error', (e) => rpc.close(e));
    child.on('exit', (code) => rpc.close(new Error(`el servidor MCP terminó (código ${code})`)));

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
      return rpc.request('tools/call', { name, arguments: args || {} }, { timeoutMs: 60000 });
    },
    async stop() {
      try { rpc?.close(); } catch { /* ya cerrado */ }
      if (!child || child.exitCode !== null || child.killed) return;
      // En Windows el hijo directo es el wrapper cmd.exe: kill() solo mataría al wrapper y el server
      // real (node/npx) quedaría huérfano. taskkill /T baja el árbol completo.
      if (process.platform === 'win32' && child.pid) {
        try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { child.kill(); }
      } else {
        try { child.kill(); } catch { /* ya terminó */ }
      }
    }
  };
}
