// T1 (R14) — la instantánea del `revisor` tal como está HOY.
//
// La spec 009 generaliza un mecanismo que ya funciona: pasar de un rol cableado a N roles derivados
// de un contrato. Eso es una refactorización, y la regla es la misma que en la 011 — al terminar, el
// revisor tiene que hacer exactamente lo que hacía.
//
// Se escribe ANTES de mover nada, contra el código actual y en verde, y NO se toca durante la
// refactorización. Si algo aquí se pone rojo, se arregla el código nuevo — nunca la expectativa.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { equipForSpec } from '../lib/commands/equip.mjs';

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-role-snap-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

const jest = () => project({
  'package.json': { name: 'demo', devDependencies: { jest: '^29.0.0' }, scripts: { test: 'jest' } }
});

const equipped = async (target, specLang = 'español') => {
  const proj = await jest();
  await equipForSpec(proj, 'lite', target, specLang);
  return proj;
};

// Todo el texto que un target dejó, para buscar el prompt sin depender de dónde lo puso.
async function emittedText(proj) {
  const { readdir } = await import('node:fs/promises');
  const chunks = [];
  for (const entry of await readdir(proj, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:md|mdc)$/.test(entry.name)) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    if (path.includes('.chalc')) continue;   // portón, advisor y skills tienen sus propios tests
    chunks.push(await readFile(path, 'utf8'));
  }
  return chunks.join('\n');
}

// ── Claude Code: subagente con permisos ───────────────────────────────────────────────────────

test('R14 — claude proyecta el revisor como subagente con frontmatter', async () => {
  const proj = await equipped('claude');
  const agent = await readFile(join(proj, '.claude', 'agents', 'revisor.md'), 'utf8');

  assert.match(agent, /^---\r?\n[\s\S]*?\r?\n---/, 'necesita frontmatter');
  assert.match(agent, /^name:\s*revisor$/m);
  assert.match(agent, /^description:\s*\S/m);
});

test('R14 — las herramientas concedidas hoy son exactamente estas', async () => {
  const proj = await equipped('claude');
  const agent = await readFile(join(proj, '.claude', 'agents', 'revisor.md'), 'utf8');
  const tools = /^tools:\s*([^\r\n]+)$/m.exec(agent)[1].split(',').map((t) => t.trim()).sort();

  assert.deepEqual(tools, ['Bash', 'Glob', 'Grep', 'Read', 'Write']);
});

// ── Cursor: regla ─────────────────────────────────────────────────────────────────────────────

// ÚNICO cambio deliberado respecto de la instantánea original: el archivo pasa de
// `chalc-reviewer.mdc` —un nombre en inglés cableado— a `chalc-<id>.mdc`, derivado del contrato.
// Con varios roles, un nombre fijo no serviría. El huérfano no es un problema: `cleanPrefixed` ya
// barre las reglas `chalc-*` obsoletas antes de escribir, así que re-equipar un repo de la spec 007
// se lleva el archivo viejo.
test('R14 — cursor proyecta el revisor como regla propia, nombrada por su contrato', async () => {
  const proj = await equipped('cursor');

  assert.ok(existsSync(join(proj, '.cursor', 'rules', 'chalc-revisor.mdc')));
  assert.ok(!existsSync(join(proj, '.cursor', 'rules', 'chalc-reviewer.mdc')), 'no puede quedar el nombre viejo');
});

// ── Codex, Copilot y Gemini: sección del bloque gestionado ────────────────────────────────────

for (const target of ['codex', 'copilot', 'gemini']) {
  test(`R14 — ${target} proyecta el revisor dentro de su bloque gestionado`, async () => {
    const text = await emittedText(await equipped(target));

    assert.match(text, /Agente revisor|Reviewer agent/i, `${target}: no aparece el revisor`);
  });
}

// ── el contenido del prompt, en los dos idiomas ───────────────────────────────────────────────

for (const [specLang, marker] of [['español', /Eres el \*\*revisor\*\*/], ['English', /You are the \*\*reviewer\*\*/i]]) {
  test(`R14 — el prompt del revisor llega en ${specLang}`, async () => {
    const proj = await equipped('claude', specLang);
    const agent = await readFile(join(proj, '.claude', 'agents', 'revisor.md'), 'utf8');

    assert.match(agent, marker);
  });
}

test('R14 — el prompt lleva las skills activas del repo, no una lista genérica', async () => {
  const proj = await equipped('claude');
  const agent = await readFile(join(proj, '.claude', 'agents', 'revisor.md'), 'utf8');

  assert.ok(!agent.includes('{{SKILLS}}'), 'el marcador debe estar sustituido');
  assert.match(agent, /clean-code/, 'las skills del repo entran en el prompt');
});

// ── lo que el revisor lee y escribe ───────────────────────────────────────────────────────────

test('R14 — el revisor sigue leyendo la evidencia del portón y la constitución', async () => {
  const proj = await equipped('claude');
  const agent = await readFile(join(proj, '.claude', 'agents', 'revisor.md'), 'utf8');

  assert.match(agent, /\.chalc\/gate\.md/);
  assert.match(agent, /constitution\.md/);
});

test('R14 — el revisor sigue anotando en la bitácora, y solo ahí', async () => {
  const proj = await equipped('claude');
  const agent = await readFile(join(proj, '.claude', 'agents', 'revisor.md'), 'utf8');

  assert.match(agent, /\.chalc\/review\.md/);
  assert.match(agent, /No modificas archivos/i);
});
