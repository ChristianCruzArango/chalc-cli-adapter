// T17 y T18 (R15) — el revisor deja rastro, y lo deja con CUALQUIER CLI.
//
// Sin rastro, el advisor puede secuenciar la llamada al revisor pero no comprobar que ocurrió — y
// vuelve exactamente la deriva que la spec 008 existe para matar. Por eso `.chalc/review.md`, en
// modo solo añadir, con un encabezado de formato fijo que `review.mjs` sabe leer.
//
// Es una **excepción deliberada a R12 de la spec 007**, que prohíbe al revisor modificar archivos.
// Se acota a un archivo y a un modo de escritura, y la spec 008 lo declara como enmienda.
//
// Y lo que el usuario pidió explícitamente: esto tiene que quedar resuelto al equipar, sea cual sea
// el CLI. En Claude Code el permiso es una herramienta concedida; en los targets sin subagente es
// prosa dentro del bloque gestionado. Los cinco se comprueban aquí.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { equipForSpec } from '../lib/commands/equip.mjs';
import { roleText } from '../lib/targetkit.mjs';
import { loadRoles } from '../lib/roles.mjs';
import { lastReview } from '../catalog/next/lib/review.mjs';

// El revisor pasó a ser un rol del catálogo (spec 009): mismo prompt, ahora con contrato.
const REVISOR = (await loadRoles()).find((r) => r.id === 'revisor');

const CATALOG = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'catalog');

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-reviewer-log-'));
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

// Todo el texto que un target dejó en el repo, para buscar la instrucción sin depender del formato.
async function equippedText(proj) {
  const chunks = [];
  for (const rel of await readdir(proj, { recursive: true, withFileTypes: true })) {
    if (!rel.isFile()) continue;
    const path = join(rel.parentPath ?? rel.path, rel.name);
    if (/\.(?:md|mdc|json)$/.test(rel.name) && !path.includes(`${'.chalc'}${'/'}next`) && !path.includes('gate')) {
      chunks.push(await readFile(path, 'utf8'));
    }
  }
  return chunks.join('\n');
}

// ── T17: la plantilla del revisor manda anotar ────────────────────────────────────────────────

test('R15 — el revisor tiene instrucción de anotar en .chalc/review.md, en los dos idiomas', async () => {
  for (const specLang of ['español', 'English']) {
    const { text } = await roleText(CATALOG, REVISOR, { skills: ['clean-code'], specLang });
    assert.match(text, /\.chalc\/review\.md/, `${specLang}: no se le pide dejar rastro`);
  }
});

test('R15 — la plantilla enseña el encabezado EXACTO que el advisor sabe leer', async () => {
  for (const specLang of ['español', 'English']) {
    const { text } = await roleText(CATALOG, REVISOR, { specLang });
    assert.match(text, /OK/, `${specLang}: falta el veredicto OK`);
    assert.match(text, /FINDINGS:/, `${specLang}: falta la forma con hallazgos`);
  }
});

test('R15 — el ejemplo de la plantilla lo entiende de verdad el lector del advisor', async () => {
  // Si la plantilla enseña un formato que `review.mjs` no sabe leer, el revisor escribe algo que el
  // advisor descarta y la tarea nunca cierra. Este test los ata.
  const { text } = await roleText(CATALOG, REVISOR, { specLang: 'español' });
  const example = text.split(/\r?\n/).find((line) => /^##\s+\d{4}-\d{2}-\d{2}T/.test(line));

  assert.ok(example, 'la plantilla tiene que traer un ejemplo literal del encabezado');
  assert.equal(lastReview(example).exists, true, `el advisor no sabe leer el ejemplo: ${example}`);
});

test('R15 — sigue prohibido tocar cualquier OTRO archivo', async () => {
  for (const specLang of ['español', 'English']) {
    const { text } = await roleText(CATALOG, REVISOR, { specLang });
    assert.match(text, /(?:No modificas|You do not modify|no modifica)/i, `${specLang}: se perdió la prohibición`);
  }
});

// ── T18: en los cinco CLIs ────────────────────────────────────────────────────────────────────

for (const target of ['claude', 'codex', 'copilot', 'cursor', 'gemini']) {
  test(`R15 — con el target ${target}, el repo equipado lleva la instrucción de anotar`, async () => {
    const proj = await jest();
    await equipForSpec(proj, 'lite', target, 'español');

    assert.match(await equippedText(proj), /\.chalc\/review\.md/, `${target}: el revisor no dejaría rastro`);
  });
}

test('R15 — en Claude Code el revisor puede escribir ese archivo, no solo se le pide', async () => {
  // En el subagente el permiso es una herramienta concedida: sin Write, la instrucción es papel
  // mojado y el advisor se quedaría clavado en `call_reviewer` para siempre.
  const proj = await jest();
  await equipForSpec(proj, 'lite', 'claude', 'español');

  const agent = await readFile(join(proj, '.claude', 'agents', 'revisor.md'), 'utf8');
  const tools = /^tools:\s*(.+)$/m.exec(agent);

  assert.ok(tools, 'el subagente declara sus herramientas');
  assert.match(tools[1], /Write|Edit/, 'sin permiso de escritura no puede dejar la bitácora');
});
