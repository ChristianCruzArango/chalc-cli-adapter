// Spec 029 (hooks, integridad y CI), T8 — las carpetas de configuración de asistentes no son código del proyecto
// (R14). Las skills equipadas traen scripts propios (`.claude/skills/<id>/scripts/*.mjs`): medirlos como si fueran
// de la tarea llenaba el informe de hallazgos ajenos y bloqueaba el primer commit tras equipar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isUserSource } from '../catalog/gate/lib/sources.mjs';
import { runHook } from '../catalog/gate/lib/hook.mjs';

test('R14: lo que vive en una carpeta de asistente no es código del proyecto', () => {
  for (const file of [
    '.chalc/gate/gate.mjs', '.claude/skills/hallmark/scripts/capture.mjs', '.claude/hooks/mi-hook.js',
    '.agents/skills/x/run.py', '.cursor/rules/a.ts', '.codex/tool.mjs', '.claude\\skills\\x\\a.ts'
  ]) assert.equal(isUserSource(file), false, file);
});

test('R14: el código del proyecto sigue siéndolo, aunque su ruta se parezca', () => {
  for (const file of ['src/a.ts', 'bin/chalc.mjs', 'apps/web/.config/b.ts', 'src/.claude-like/a.ts', 'claude/a.ts', 'src/agents/a.py', '.github/scripts/release.mjs']) {
    assert.equal(isUserSource(file), true, file);
  }
});

test('R14: lo que no es fuente tampoco lo es dentro ni fuera de esas carpetas', () => {
  for (const file of ['.claude/settings.json', 'README.md', '.chalc/gate.json', '', null]) assert.equal(isUserSource(file), false, String(file));
});

test('R14: un commit que solo lleva lo equipado (skills con scripts) no corre el portón', async () => {
  let ran = false;
  const code = await runHook('pre-commit', {
    staged: async () => ['CLAUDE.md', '.claude/skills/hallmark/scripts/capture.mjs', '.chalc/gate/gate.mjs', '.agents/skills/x/run.py'],
    fastGate: async () => { ran = true; return 1; }
  });
  assert.deepEqual([code, ran], [0, false]);
});
