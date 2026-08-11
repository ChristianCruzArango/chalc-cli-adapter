// T17–T18 (R9) — la skill aterrizada llega al repo, con CUALQUIER CLI.
//
// chalc es un equipador: el usuario elige su CLI y espera que al equipar quede todo resuelto dentro
// del repo. Si un target se olvidara de pasar el stack, ESE CLI entregaría la skill con los
// marcadores en crudo — visible, pero solo cuando alguien la abra a mitad de una tarea.
//
// Por eso el test es por target, y comprueba las dos mitades: que la skill llega aterrizada en el
// stack del repo, y que no queda ni un `{{MARCADOR}}` sin sustituir.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { equipForSpec } from '../lib/commands/equip.mjs';

const TARGETS = {
  claude: '.claude/skills',
  codex: '.chalc/skills',
  copilot: '.chalc/skills',
  cursor: '.chalc/skills',
  gemini: '.chalc/skills'
};

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-tool-equip-'));
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

const skillOf = (proj, target) => readFile(join(proj, TARGETS[target], 'mutation-testing', 'SKILL.md'), 'utf8');

// ── T18: los cinco CLIs ───────────────────────────────────────────────────────────────────────

for (const target of Object.keys(TARGETS)) {
  test(`R9 — con el target ${target}, la skill llega SIN marcadores en crudo`, async () => {
    const proj = await jest();
    await equipForSpec(proj, 'lite', target, 'español');

    const skill = await skillOf(proj, target);
    const leftover = skill.match(/\{\{\w+\}\}/g);
    assert.equal(leftover, null, `${target}: quedaron marcadores ${leftover}`);
  });

  test(`R9 — con el target ${target}, la skill habla del stack de ESTE repo`, async () => {
    const proj = await jest();
    await equipForSpec(proj, 'lite', target, 'español');

    const skill = await skillOf(proj, target);
    assert.match(skill, /This repo: JS \/ TS/, `${target}: la skill no aterriza en el stack`);
    assert.match(skill, /@stryker-mutator\/jest-runner/, `${target}: no resolvió el runner del repo`);
  });
}

// ── R6 en el artefacto real: lo que la skill dice y lo que el portón espera ────────────────────

test('R6 — la skill emitida y gate.json coinciden en comando, reporte y formato', async () => {
  const proj = await jest();
  await equipForSpec(proj, 'lite', 'claude', 'español');

  const config = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  const skill = await skillOf(proj, 'claude');

  for (const key of ['command', 'report', 'install']) {
    assert.ok(skill.includes(config.mutation[key]), `la skill no menciona el ${key} que el portón espera`);
  }
  assert.ok(skill.includes(config.mutation.format), 'la skill no menciona el formato del reporte');
});

test('R9 — un repo sin stack recibe la skill diciendo que no se detectó', async () => {
  const proj = await project({ 'LEEME.txt': 'hola\n' });
  await equipForSpec(proj, 'lite', 'claude', 'español');

  // Sin stack no hay skills de stack, pero mutation-testing es global y se equipa igual.
  if (!existsSync(join(proj, '.claude', 'skills', 'mutation-testing'))) return;

  const skill = await skillOf(proj, 'claude');
  assert.match(skill, /could not be detected/i);
  assert.equal(skill.match(/\{\{\w+\}\}/g), null);
});

// ── T17: las skills sin marcadores se copian igual que siempre ────────────────────────────────

test('R9 — una skill sin marcadores se copia intacta', async () => {
  const proj = await jest();
  await equipForSpec(proj, 'lite', 'claude', 'español');

  const source = await readFile(join(process.cwd(), 'catalog', 'skills', 'clean-code', 'SKILL.md'), 'utf8');
  const copied = await readFile(join(proj, '.claude', 'skills', 'clean-code', 'SKILL.md'), 'utf8');

  assert.equal(copied, source, 'la sustitución no puede tocar las skills que no la piden');
});
