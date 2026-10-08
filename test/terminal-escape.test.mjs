// S-16 — lo que dicen el modelo, las herramientas o un servidor MCP no puede mover el cursor, borrar
// líneas, ocultar texto ni escribir en el portapapeles al imprimirse.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripControl } from '../lib/termsafe.mjs';
import { createShellTool } from '../cli/tools/shell.mjs';

const HOSTILE = ['\x1b[2K\x1b[1G', '\x1b[8mhidden', '\x1b]52;c;cHduZWQ=\x07', '\x1b[5mblink', '\x1b[7mrev', '\x9b2J', '\x1bc'];

test('the interface keeps its own colours and drops everything else', () => {
  const own = '\x1b[1mbold\x1b[0m \x1b[2mdim\x1b[0m \x1b[31mred\x1b[0m \x1b[90mgray\x1b[0m';
  assert.equal(stripControl(own, { keepStyles: true }), own);
  for (const bad of HOSTILE) {
    const out = stripControl(`ok ${bad} end`, { keepStyles: true });
    assert.equal(/[\x1b\x07\x9b]/.test(out.replace(/\x1b\[[0-9;]*m/g, '')), false, JSON.stringify(bad));
    assert.equal(/\x1b\[(8|5|7)m/.test(out), false, JSON.stringify(bad));
  }
});

test('a command with an escape sequence is refused before approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-s16-'));
  let asked = false;
  const { bash } = createShellTool({ root, allow: ['ls'], approve: async () => { asked = true; return true; } });
  const r = await bash.run({ command: 'ls \x1b[2K\x1b[1Gsafe' });
  assert.match(r.error, /control characters/);
  assert.equal(asked, false);
});
