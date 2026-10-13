// T8 (spec 017, R7) — la guarda se DOCUMENTA, no se instala.
//
// Como los otros dos hooks del portón (spec 007, R19; spec 013, R10b), chalc no toca la configuración
// del asistente: deja en `.chalc/gate-hook.md` el bloque listo para pegar. Esa documentación es la
// entrega, así que se le exige lo mismo que al código: que el bloque funcione (JSON válido, un archivo
// que existe, un matcher que cubre TODAS las herramientas que la guarda vigila) y que diga en los dos
// idiomas qué pregunta, qué bloquea y hasta dónde llega.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARDED_TOOLS } from '../catalog/gate/lib/guard-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = join(ROOT, 'catalog', 'hooks');
const DOCS = ['gate-hook.md', 'gate-hook.en.md'];
// El checkout de Windows trae CRLF: se normaliza antes de las regex, como hace ci-hardening.
const read = async (file) => (await readFile(join(HOOKS, file), 'utf8')).replace(/\r\n/g, '\n');

const jsonBlocks = (doc) => [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
const guardBlock = (doc) => jsonBlocks(doc).find((block) => block.includes('guard.mjs'));

test('R7: every json block of the hook document is valid json, in both languages', async () => {
  for (const file of DOCS) {
    const blocks = jsonBlocks(await read(file));
    assert.ok(blocks.length >= 3, `${file}: faltan bloques`);
    for (const block of blocks) assert.doesNotThrow(() => JSON.parse(block), `${file}: ${block.slice(0, 60)}`);
  }
});

test('R7: the guard block is a PreToolUse hook that runs the guard of the equipped repo', async () => {
  for (const file of DOCS) {
    const block = JSON.parse(guardBlock(await read(file)) || 'null');
    assert.ok(block, `${file}: falta el bloque de la guarda`);
    const [entry] = block.hooks.PreToolUse;
    assert.deepEqual(entry.hooks, [{ type: 'command', command: 'node .chalc/gate/guard.mjs' }], file);
  }
});

test('R7: the documented command points at a file chalc emits', () => {
  // `.chalc/gate/` es la copia del árbol `catalog/gate/` (lib/gateemit.mjs).
  assert.ok(existsSync(join(ROOT, 'catalog', 'gate', 'guard.mjs')));
});

test('R7: the matcher covers every tool the guard looks at, and nothing else', async () => {
  for (const file of DOCS) {
    const [entry] = JSON.parse(guardBlock(await read(file))).hooks.PreToolUse;
    assert.deepEqual(entry.matcher.split('|').sort(), [...GUARDED_TOOLS].sort(), file);
  }
});

test('R7: the guard block is the same in both languages', async () => {
  const [es, en] = await Promise.all(DOCS.map(read));
  assert.equal(guardBlock(es), guardBlock(en));
});

test('R7: the document says what the guard asks, what it blocks and where it stops', async () => {
  const expectations = {
    'gate-hook.md': [/git commit/, /git push/, /--force/, /\.env\.example/, /fuera del proyecto/i, /no es inviolable/i, /allow/],
    'gate-hook.en.md': [/git commit/, /git push/, /--force/, /\.env\.example/, /outside the project/i, /not unbreakable/i, /allow/]
  };
  for (const [file, patterns] of Object.entries(expectations)) {
    const doc = await read(file);
    for (const pattern of patterns) assert.match(doc, pattern, `${file}: ${pattern}`);
  }
});

test('R7: the document counts three hooks now', async () => {
  assert.match(await read('gate-hook.md'), /^Tres hooks/m);
  assert.match(await read('gate-hook.en.md'), /^Three hooks/m);
});
