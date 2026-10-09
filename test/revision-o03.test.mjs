// O-03 (spec 016, R26) — al terminar por error o por señal se restaura la terminal y no quedan procesos
// hijos vivos (MCP escala a SIGKILL); la salida de los hijos se decodifica como UTF-8 por flujo, sin
// romper un carácter partido entre dos trozos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSignalExit } from '../lib/fatal.mjs';
import { createScreen } from '../cli/ui/screen.mjs';
import { createStdioClient } from '../cli/mcp/client.mjs';
import { execBounded } from '../cli/tools/shell.mjs';

const POSIX = process.platform !== 'win32';
// Los scripts auxiliares se escriben en una carpeta temporal: un .mjs dentro de test/ lo ejecutaría
// `node --test` como si fuese una suite (y el servidor falso, que ignora SIGTERM, no terminaría nunca).
const FIXTURES = mkdtempSync(join(tmpdir(), 'chalc-o03-'));
const CLIENT_URL = new URL('../cli/mcp/client.mjs', import.meta.url).href;
const SOURCES = {
  // Servidor MCP falso: ignora SIGTERM (obliga a escalar a SIGKILL) y parte un carácter UTF-8 entre dos
  // escrituras al responder tools/list.
  'o03-mcp-server.mjs': `
process.on('SIGTERM', () => {});
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\\n')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, nl));
    buffer = buffer.slice(nl + 1);
    if (msg.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
    if (msg.method === 'tools/list') {
      const line = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'año', description: 'señal ñandú' }] } }) + '\\n');
      const cut = line.indexOf(Buffer.from('ñ')) + 1;
      process.stdout.write(line.subarray(0, cut));
      setTimeout(() => process.stdout.write(line.subarray(cut)), 50);
    }
  }
});
setInterval(() => {}, 1000);
`,
  // 600 «ñ»: 600 caracteres pero 1200 bytes.
  'o03-many-n.mjs': `process.stdout.write('ñ'.repeat(600));`,
  // Escribe «ñ» partida en dos trozos de salida.
  'o03-split-utf8.mjs': `
const n = Buffer.from('añb');
process.stdout.write(n.subarray(0, 2));
setTimeout(() => process.stdout.write(n.subarray(2)), 50);
`,
  // Arranca un cliente MCP, imprime el pid del servidor y sale con process.exit.
  'o03-exit-with-mcp.mjs': `
import { createStdioClient } from '${CLIENT_URL}';
const client = createStdioClient({ command: process.execPath, args: [new URL('./o03-mcp-server.mjs', import.meta.url).pathname] });
await client.start();
process.stdout.write(String(client.pid) + '\\n');
process.exit(0);
`
};
for (const [name, source] of Object.entries(SOURCES)) writeFileSync(join(FIXTURES, name), source);
const fixture = (name) => join(FIXTURES, name);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('R26: SIGTERM and SIGHUP exit through process.exit (so the exit cleanups run) with 128+n', { timeout: 5000 }, () => {
  const proc = new EventEmitter();
  const exits = [];
  installSignalExit({ proc, exit: (code) => exits.push(code) });
  proc.emit('SIGTERM');
  proc.emit('SIGHUP');
  assert.deepEqual(exits, [143, 129]);
});

test('R26: the TUI restores the terminal on process exit while open, and stops doing so once closed', { timeout: 5000 }, () => {
  const written = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  const before = process.listenerCount('exit');
  try {
    const screen = createScreen({ header: [] });
    screen.open();
    assert.equal(process.listenerCount('exit'), before + 1);
    process.listeners('exit').at(-1)();
    const restore = written.join('');
    for (const seq of ['\x1b[?1000l', '\x1b[?1006l', '\x1b[?2004l', '\x1b[?25h']) assert.ok(restore.includes(seq), JSON.stringify(seq));
    screen.close();
    assert.equal(process.listenerCount('exit'), before);
  } finally { process.stdout.write = original; process.stdin.pause(); }
});

test('R26: MCP stop escalates to SIGKILL for a server that ignores SIGTERM', { timeout: 10000, skip: !POSIX }, async () => {
  const client = createStdioClient({ command: process.execPath, args: [fixture('o03-mcp-server.mjs')], stopGraceMs: 300 });
  await client.start();
  const pid = client.pid;
  assert.equal(alive(pid), true);
  const started = Date.now();
  await client.stop();
  assert.equal(alive(pid), false);
  assert.ok(Date.now() - started < 3000);
});

test('R26: an MCP server is not left orphaned when the CLI process exits', { timeout: 10000, skip: !POSIX }, async () => {
  const r = spawnSync(process.execPath, [fixture('o03-exit-with-mcp.mjs')], { encoding: 'utf8', timeout: 8000 });
  const pid = Number(r.stdout.trim());
  assert.ok(pid > 0, r.stderr);
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(alive(pid), false);
});

test('R26: MCP decodes a UTF-8 character split across two chunks', { timeout: 10000, skip: !POSIX }, async () => {
  const client = createStdioClient({ command: process.execPath, args: [fixture('o03-mcp-server.mjs')], stopGraceMs: 300 });
  await client.start();
  try {
    assert.deepEqual(await client.listTools(), [{ name: 'año', description: 'señal ñandú' }]);
  } finally { await client.stop(); }
});

test('R26: the shell decodes a UTF-8 character split across two chunks', { timeout: 10000 }, async () => {
  const r = await execBounded(`${JSON.stringify(process.execPath)} ${JSON.stringify(fixture('o03-split-utf8.mjs'))}`, { cwd: process.cwd() });
  assert.equal(r.stdout, 'añb');
});

test('R26: the shell output limit is still measured in bytes, not characters', { timeout: 10000 }, async () => {
  const r = await execBounded(`${JSON.stringify(process.execPath)} ${JSON.stringify(fixture('o03-many-n.mjs'))}`, { cwd: process.cwd(), maxBuffer: 1000 });
  assert.match(r.stderr, /output exceeded limit/);
});
