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

// Tras el SIGTERM de stop(), cuánto se espera antes de SIGKILL: un servidor que lo ignora seguía vivo (O-03).
const STOP_GRACE_MS = 2000;

// Servidores vivos: al salir el CLI (también por señal, ver lib/fatal.mjs) se matan, síncronamente.
const live = new Set();
let exitHooked = false;
function track(child) {
  live.add(child);
  child.on('exit', () => live.delete(child));
  if (exitHooked) return;
  exitHooked = true;
  process.on('exit', () => { for (const c of live) killTree(c, 'SIGKILL'); });
}

// Termina el servidor: SIGTERM, SIGKILL si sigue vivo tras el margen; resuelve cuando ha salido.
function stopChild(child, graceMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const hard = setTimeout(() => killTree(child, 'SIGKILL'), graceMs);
    child.once('exit', () => { clearTimeout(hard); resolve(); });
    killTree(child);
  });
}

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
// que supera el tope cierra la conexión y mata al servidor, con su ÁRBOL: en Windows el hijo es el
// envoltorio cmd.exe y matar solo ese dejaba al servidor real vivo, inundando la tubería heredada (el
// proceso nunca terminaba; CI de Windows colgado). Recibe texto ya decodificado por flujo
// (`setEncoding`): `chunk.toString()` por trozo rompía un carácter UTF-8 partido entre dos (O-03).
function lineReader(child, rpc) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_LINE_BYTES && buffer.indexOf('\n') < 0) {
      buffer = '';
      rpc.close(new Error(t('mcpLineTooLong', MAX_LINE_BYTES)));
      killTree(child, 'SIGKILL');
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


// Conecta los flujos del servidor con el JSON-RPC: stdout/stderr decodificados por flujo (O-03) y los
// errores de E/S convertidos en rechazo del request pendiente.
function wireServer(child, rpc, onStderr) {
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', lineReader(child, rpc));
  child.stderr.setEncoding('utf8');
  if (onStderr) child.stderr.on('data', onStderr);
  // Sin este listener, un write tras la muerte del server (EPIPE) sería una excepción no capturada
  // que tumba todo el CLI; con él, el request pendiente se rechaza y el loop sigue.
  child.stdin.on('error', (e) => rpc.close(e));
  child.on('error', (e) => rpc.close(e));
  child.on('exit', (code) => rpc.close(new Error(t('mcpServerExited', code))));
}

export function createStdioClient({ command, args = [], env, cwd, timeoutMs = MCP_REQUEST_TIMEOUT_MS, onStderr, stopGraceMs = STOP_GRACE_MS } = {}) {
  if (!command) throw new Error(t('mcpNoCommand'));
  let child = null;
  let rpc = null;

  const start = async () => {
    child = spawnServer({ command, args, env, cwd });
    track(child);
    rpc = createJsonRpc({ send: (m) => child.stdin.write(JSON.stringify(m) + '\n'), timeoutMs });
    wireServer(child, rpc, onStderr);

    await rpc.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
    rpc.notify('notifications/initialized', {});
  };

  return {
    start,
    get pid() { return child?.pid; },
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
      await stopChild(child, stopGraceMs);
    }
  };
}
