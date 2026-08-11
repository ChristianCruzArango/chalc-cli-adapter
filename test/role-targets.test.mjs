// T8–T10 (R3, R5, R6) — lo que cada CLI puede hacer cumplir de verdad.
//
// Solo Claude Code concede permisos por agente. En Cursor el rol es una regla y en Codex, Copilot y
// Gemini una sección del bloque gestionado: ahí nada impide técnicamente que el rol escriba donde no
// debe. Llamar "contrato" a las tres cosas por igual vendería una garantía que no existe.
//
// Así que se comprueban dos cosas distintas: donde HAY permisos, que sean exactamente los del
// contrato; donde NO los hay, que lo emitido lo diga en vez de fingir.
//
// Todo recorre el DIRECTORIO de roles, nunca una lista escrita aquí: un rol nuevo entra solo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadRoles, toolsFor } from '../lib/roles.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'catalog');

const roles = await loadRoles();

// Targets con modelo de permisos por agente, y sin él.
const WITH_PERMISSIONS = ['claude'];
const WITHOUT_PERMISSIONS = ['codex', 'copilot', 'cursor', 'gemini'];

async function equipWith(name, specLang = 'español') {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-role-targets-'));
  await mkdir(join(dir, 'specs'), { recursive: true });
  await writeFile(join(dir, 'specs', 'constitution.md'), '# Constitución\n', 'utf8');

  const target = await import(`../targets/${name}.mjs`);
  await target.apply({
    projectPath: dir, CATALOG, skills: ['clean-code'], mcps: [], methods: [], stacks: [],
    specLang, roles, dryRun: false
  });
  return dir;
}

// Todo el texto de asistente que un target dejó.
async function emitted(dir) {
  const parts = [];
  for (const rel of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md']) {
    if (existsSync(join(dir, rel))) parts.push(await readFile(join(dir, rel), 'utf8'));
  }
  for (const sub of [join(dir, '.cursor', 'rules'), join(dir, '.claude', 'agents')]) {
    if (!existsSync(sub)) continue;
    for (const f of await readdir(sub)) parts.push(await readFile(join(sub, f), 'utf8'));
  }
  return parts.join('\n');
}

// ── T8: donde hay permisos, son EXACTAMENTE los del contrato ──────────────────────────────────

for (const target of WITH_PERMISSIONS) {
  for (const role of roles) {
    test(`R3 — ${target}/${role.id}: las herramientas concedidas son las del contrato`, async () => {
      const dir = await equipWith(target);
      const agent = await readFile(join(dir, '.claude', 'agents', `${role.id}.md`), 'utf8');
      const declared = /^tools:\s*([^\r\n]+)$/m.exec(agent);

      assert.ok(declared, `${role.id}: el subagente debe declarar sus herramientas`);
      assert.deepEqual(
        declared[1].split(',').map((t) => t.trim()).sort(),
        [...toolsFor(role)].sort(),
        `${role.id}: lo concedido no coincide con el contrato`
      );
    });
  }

  test(`R3 — ${target}: ningún rol recibe una herramienta de edición`, async () => {
    const dir = await equipWith(target);

    for (const role of roles) {
      const agent = await readFile(join(dir, '.claude', 'agents', `${role.id}.md`), 'utf8');
      const declared = /^tools:\s*([^\r\n]+)$/m.exec(agent)[1];
      for (const forbidden of ['Edit', 'NotebookEdit', 'MultiEdit']) {
        assert.ok(!declared.includes(forbidden), `${role.id} recibió ${forbidden}`);
      }
    }
  });
}

// ── T9: donde NO hay permisos, se dice ────────────────────────────────────────────────────────

for (const target of WITHOUT_PERMISSIONS) {
  test(`R5 — ${target}: lo emitido avisa de que el alcance es instrucción, no restricción`, async () => {
    const text = await emitted(await equipWith(target));

    assert.match(text, /instrucción, no restricción/i, `${target}: no avisa de que no puede hacerlo cumplir`);
  });

  test(`R5 — ${target}: el aviso nombra lo que el rol SÍ puede escribir`, async () => {
    const text = await emitted(await equipWith(target));

    for (const role of roles) {
      for (const path of role.writes || []) {
        assert.ok(text.includes(path), `${target}/${role.id}: el aviso no nombra ${path}`);
      }
    }
  });

  test(`R5 — ${target}: el aviso llega en inglés cuando el spec está en inglés`, async () => {
    const text = await emitted(await equipWith(target, 'English'));

    assert.match(text, /an instruction, not a restriction/i);
  });
}

// Claude Code NO lleva ese aviso: ahí el alcance sí es una restricción, y repetirlo como si fuera
// una súplica restaría fuerza al permiso real.
test('R5 — claude no lleva el aviso: ahí el alcance sí se hace cumplir', async () => {
  const text = await emitted(await equipWith('claude'));

  assert.ok(!/instrucción, no restricción/i.test(text));
});

// ── todos los roles llegan, en los cinco targets ──────────────────────────────────────────────

for (const target of [...WITH_PERMISSIONS, ...WITHOUT_PERMISSIONS]) {
  test(`R2 — ${target} proyecta TODOS los roles del catálogo`, async () => {
    const text = await emitted(await equipWith(target));

    for (const role of roles) {
      assert.ok(text.includes(role.id), `${target}: falta el rol ${role.id}`);
    }
  });
}

// ── T10: el aviso al equipar ──────────────────────────────────────────────────────────────────

test('R6 — hay claves de i18n para decir qué roles quedaron con permisos y cuáles no', async () => {
  const { DICT } = await import("../lib/i18n.mjs");

  for (const key of ['rolesEnforced', 'rolesAdvisory']) {
    assert.ok(DICT.es[key], `falta la clave ${key} en es`);
    assert.ok(DICT.en[key], `falta la clave ${key} en en`);
  }
});

// ── T18 (R12) — modo worktree ─────────────────────────────────────────────────────────────────

test('R12 — equipar un worktree deja los roles DENTRO y no toca el repo principal', async () => {
  const { equipForSpec } = await import('../lib/commands/equip.mjs');
  const { readdir: list } = await import('node:fs/promises');

  const main = await mkdtemp(join(tmpdir(), 'chalc-role-main-'));
  await writeFile(join(main, 'package.json'), JSON.stringify({ name: 'main' }), 'utf8');
  const worktree = await mkdtemp(join(tmpdir(), 'chalc-role-wt-'));
  await writeFile(join(worktree, 'package.json'), JSON.stringify({ name: 'wt' }), 'utf8');

  const before = (await list(main)).sort();
  await equipForSpec(worktree, 'lite', 'claude', 'español');

  assert.deepEqual((await list(main)).sort(), before, 'el repo principal quedó intacto');
  for (const role of roles) {
    assert.ok(existsSync(join(worktree, '.claude', 'agents', `${role.id}.md`)), `falta ${role.id} en el worktree`);
  }
});
