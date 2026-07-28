import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as claude from '../targets/claude.mjs';
import * as gemini from '../targets/gemini.mjs';
import * as copilot from '../targets/copilot.mjs';
import * as codex from '../targets/codex.mjs';

// El archivo de instrucciones del usuario (CLAUDE.md / GEMINI.md / copilot-instructions.md / AGENTS.md)
// es SAGRADO: equipar debe FUSIONAR el bloque de chalc, nunca sobrescribir/borrar lo que el usuario ya tenía.
const CASES = [
  { name: 'Claude', mod: claude, rel: 'CLAUDE.md' },
  { name: 'Gemini', mod: gemini, rel: 'GEMINI.md' },
  { name: 'Copilot', mod: copilot, rel: join('.github', 'copilot-instructions.md') },
  { name: 'Codex', mod: codex, rel: 'AGENTS.md' }
];

for (const { name, mod, rel } of CASES) {
  test(`${name}: apply() preserva el contenido del usuario y añade el bloque chalc`, async () => {
    const base = await mkdtemp(join(tmpdir(), 'chalc-target-'));
    const file = join(base, rel);
    await mkdir(join(base, rel, '..'), { recursive: true });
    const userText = '# Instrucciones del usuario\n\nEsto NO se debe borrar. Var $HOME y ejemplo $& en un comando.\n';
    await writeFile(file, userText, 'utf8');

    // apply() mínimo: sin skills/mcp/métodos → solo escribe el bloque gestionado + manifiesto.
    await mod.apply({
      projectPath: base, CATALOG: base, skills: [], mcps: [], methods: [], stacks: [], dryRun: false
    });

    const out = await readFile(file, 'utf8');
    assert.ok(out.includes('Esto NO se debe borrar. Var $HOME y ejemplo $& en un comando.'), `${name}: preserva lo del usuario`);
    assert.ok(out.includes('## ⚙️ Chalc'), `${name}: añade el bloque chalc`);
    assert.ok(out.includes('# Instrucciones del usuario'), `${name}: conserva el título del usuario`);
  });
}
