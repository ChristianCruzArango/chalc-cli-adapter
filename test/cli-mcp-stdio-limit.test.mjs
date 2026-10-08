// S-11 — un servidor MCP stdio que nunca envía fin de línea no puede agotar la memoria del CLI.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStdioClient } from '../cli/mcp/client.mjs';

test('the stdio buffer is capped and the request fails cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-s11-mcp-'));
  await writeFile(join(dir, 'flood.mjs'), "const s = 'x'.repeat(1 << 20); const w = () => process.stdout.write(s, w); w();");
  const client = createStdioClient({ command: process.execPath, args: ['flood.mjs'], cwd: dir, timeoutMs: 10000 });
  await assert.rejects(() => client.start(), /sin fin de línea|terminó|without a line break|exited/);
  await client.stop();
});
