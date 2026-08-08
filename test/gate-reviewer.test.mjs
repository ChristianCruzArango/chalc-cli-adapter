// T28 (R12) — el agente revisor, en el formato de cada target.
//
// Es la otra mitad del portón. El portón mide lo medible —score, líneas, fronteras, citas, rutas— y
// no opina. El revisor juzga lo que solo se puede juzgar leyendo: si el test comprueba el requisito
// o solo lo acompaña, si la abstracción es la correcta, si el nombre dice lo que hace. Separarlos es
// lo que evita que el portón alucine y que el revisor se pierda contando líneas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'catalog');

const SKILLS = ['clean-code', 'mutation-testing'];

async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-reviewer-'));
  await mkdir(join(dir, 'specs'), { recursive: true });
  await writeFile(join(dir, 'specs', 'constitution.md'), '# Constitución\n', 'utf8');
  return dir;
}

// Equipa el proyecto con un target y devuelve el texto de TODOS sus archivos de asistente juntos:
// el revisor tiene que estar en alguno, y cada target elige cuál. `specLang` va explícito porque el
// revisor se escribe en el idioma del SPEC, no en el del CLI que corre los tests.
async function equipWith(name, specLang = 'español') {
  const dir = await project();
  const target = await import(`../targets/${name}.mjs`);
  await target.apply({ projectPath: dir, CATALOG, skills: SKILLS, mcps: [], methods: [], stacks: [], specLang, dryRun: false });
  return dir;
}

async function assistantText(dir) {
  const parts = [];
  const files = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md', '.claude/agents/revisor.md'];
  for (const rel of files) {
    if (existsSync(join(dir, rel))) parts.push(await readFile(join(dir, rel), 'utf8'));
  }
  const rules = join(dir, '.cursor', 'rules');
  if (existsSync(rules)) {
    for (const f of await readdir(rules)) parts.push(await readFile(join(rules, f), 'utf8'));
  }
  return parts.join('\n');
}

const TARGETS = ['claude', 'codex', 'copilot', 'cursor', 'gemini'];

// ── el revisor llega en los cinco formatos ────────────────────────────────────────────────────

test('every target writes the reviewer somewhere the assistant will read it', async () => {
  for (const name of TARGETS) {
    const text = await assistantText(await equipWith(name));

    assert.match(text, /revisor/i, `${name} no proyecta el revisor`);
  }
});

// Claude Code tiene subagentes de verdad: el revisor va como agente propio, no como un párrafo más
// dentro de CLAUDE.md que compite por atención con todo lo demás.
test('the claude target writes the reviewer as a real subagent', async () => {
  const dir = await equipWith('claude');

  const agent = await readFile(join(dir, '.claude', 'agents', 'revisor.md'), 'utf8');
  assert.match(agent, /^---\r?\n[\s\S]*?\r?\n---/, 'el subagente necesita frontmatter');
  assert.match(agent, /^name:\s*revisor/m);
  assert.match(agent, /^description:\s*\S/m);
});

// R12: el revisor NO modifica archivos. En Claude Code eso no se pide, se concede: la lista de
// herramientas del subagente no incluye ninguna de escritura.
test('the claude reviewer is given no tool that can write', async () => {
  const dir = await equipWith('claude');

  const agent = await readFile(join(dir, '.claude', 'agents', 'revisor.md'), 'utf8');
  const tools = /^tools:\s*([^\r\n]+)/m.exec(agent);
  assert.ok(tools, 'el subagente debe declarar sus herramientas');
  for (const forbidden of ['Write', 'Edit', 'NotebookEdit']) {
    assert.ok(!tools[1].includes(forbidden), `el revisor no puede tener ${forbidden}`);
  }
});

test('the cursor target writes the reviewer as one of its rules', async () => {
  const dir = await equipWith('cursor');

  assert.ok(existsSync(join(dir, '.cursor', 'rules', 'chalc-reviewer.mdc')));
});

// ── qué dice el revisor ───────────────────────────────────────────────────────────────────────

test('the reviewer is told what to read: the evidence, the diff and the constitution', async () => {
  for (const name of TARGETS) {
    const text = await assistantText(await equipWith(name));

    assert.match(text, /\.chalc\/gate\.md/, `${name}: el revisor debe leer la evidencia`);
    assert.match(text, /git diff/, `${name}: el revisor debe leer el diff de la tarea`);
    assert.match(text, /specs\/constitution\.md/, `${name}: el revisor debe auditar contra la constitución`);
  }
});

// Las skills activas de ESE repo: un revisor de back no debe auditar contra reglas de Flutter.
test('the reviewer lists the active skills of this repo', async () => {
  for (const name of TARGETS) {
    const text = await assistantText(await equipWith(name));

    for (const skill of SKILLS) {
      assert.match(text, new RegExp(skill), `${name}: falta la skill ${skill} en el revisor`);
    }
  }
});

test('the reviewer is told to answer OK or a numbered list, and never to edit', async () => {
  for (const name of TARGETS) {
    const text = await assistantText(await equipWith(name));

    assert.match(text, /\bOK\b/, `${name}: falta el veredicto OK`);
    assert.match(text, /modific/i, `${name}: falta la prohibición de modificar archivos`);
  }
});

// El revisor habla el idioma del spec, no el del CLI: vive en el repo del usuario.
test('the reviewer is written in the language of the spec', async () => {
  const es = await assistantText(await equipWith('claude', 'español'));
  const en = await assistantText(await equipWith('claude', 'english'));

  assert.match(es, /No modificas archivos/);
  assert.match(en, /You do not modify files/);
});

// El portón ya midió: repetirlo sería ruido, y peor, invitaría al revisor a opinar sobre cifras que
// no calculó — que es de donde salen los "score 92%" inventados.
test('the reviewer is told not to re-judge what the gate already measured', async () => {
  const dir = await equipWith('claude');

  const agent = await readFile(join(dir, '.claude', 'agents', 'revisor.md'), 'utf8');
  assert.match(agent, /portón|gate/i);
});
