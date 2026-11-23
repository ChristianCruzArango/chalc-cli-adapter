// Spec 031 (estructura), T2 — un archivo nuevo nace en una carpeta de la arquitectura acordada (R3, R4, R5).
// El linter de fronteras mira imports; esto mira dónde se CREA el código.
import test from 'node:test';
import assert from 'node:assert/strict';
import { outsideStructure, structureFindings } from '../catalog/gate/lib/structure.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { MESSAGES } from '../catalog/gate/lib/i18n.mjs';

const FOLDERS = ['src/app/core', 'src/app/features', 'src/app/shared'];
const all = () => true;
const out = (files, over = {}) => outsideStructure(files, { folders: FOLDERS, allow: [], isNew: all, ...over }).map((f) => f.file);

test('R3: un archivo nuevo de producción fuera de las carpetas declaradas se reporta con las válidas', () => {
  assert.deepEqual(outsideStructure(['src/app/utils/fecha.ts'], { folders: FOLDERS, allow: [], isNew: all }),
    [{ file: 'src/app/utils/fecha.ts', line: 1, rule: RULES.fileOutsideStructure, data: { folders: FOLDERS } }]);
});

test('R3: dentro de una carpeta declarada, a cualquier profundidad, no se reporta', () => {
  assert.deepEqual(out(['src/app/core/a.ts', 'src/app/features/pagos/ui/boton.component.ts', 'src/app/shared/x/y/z.ts']), []);
});

test('R3: una carpeta que solo empieza igual no es la declarada', () => {
  assert.deepEqual(out(['src/app/core-extra/a.ts', 'src/app/featuresx/b.ts']), ['src/app/core-extra/a.ts', 'src/app/featuresx/b.ts']);
});

test('R4: no se reportan los que ya existían, los tests, los de la raíz ni lo que no es código', () => {
  assert.deepEqual(out(['src/app/utils/viejo.ts'], { isNew: () => false }), []);
  assert.deepEqual(out(['src/app/utils/fecha.spec.ts', 'test/fecha.test.ts', 'e2e/__tests__/a.ts']), []);
  assert.deepEqual(out(['vite.config.ts', 'eslint.config.js']), []);
  assert.deepEqual(out(['src/app/utils/notas.md', 'docs/a.png', '.claude/skills/x/run.mjs']), []);
});

test('R4: lo que cae bajo structure.allow tampoco', () => {
  assert.deepEqual(out(['scripts/migra.mjs', 'src/app/utils/a.ts'], { allow: ['scripts'] }), ['src/app/utils/a.ts']);
  assert.deepEqual(out(['src/main.ts'], { allow: ['src/main.ts'] }), [], 'también un archivo concreto');
});

test('R3: las barras de Windows y una barra final en la config no cambian el resultado', () => {
  assert.deepEqual(outsideStructure(['src\\app\\core\\a.ts', 'src\\otra\\b.ts'], { folders: ['src/app/core/', 'src\\app\\shared'], allow: [], isNew: all }).map((f) => f.file), ['src/otra/b.ts']);
});

// ── con el alcance de la tarea ────────────────────────────────────────────────────────────────────

const scope = (over = {}) => ({ files: ['src/app/utils/nuevo.ts', 'src/app/utils/viejo.ts', 'src/app/core/ok.ts'], from: 'abc123', lines: new Map([['src/app/utils/viejo.ts', new Set([3])]]), removed: new Map(), ...over });
const config = (structure) => ({ structure });

test('R3: es nuevo el archivo del alcance que no tiene líneas atribuidas en el diff', () => {
  assert.deepEqual(structureFindings(scope(), config({ folders: FOLDERS })).map((f) => f.file), ['src/app/utils/nuevo.ts']);
});

test('R4: un archivo ya versionado del que la tarea solo borró líneas no es nuevo', () => {
  const s = scope({ lines: new Map(), removed: new Map([['src/app/utils/nuevo.ts', 2], ['src/app/utils/viejo.ts', 1]]) });
  assert.deepEqual(structureFindings(s, config({ folders: FOLDERS })), []);
});

test('R5: sin carpetas declaradas, sin la clave, o sin git para saber qué es nuevo, no aplica', () => {
  assert.deepEqual(structureFindings(scope(), config({ folders: [] })), []);
  assert.deepEqual(structureFindings(scope(), config(undefined)), []);
  assert.deepEqual(structureFindings(scope(), {}), []);
  assert.deepEqual(structureFindings(scope({ from: '' }), config({ folders: FOLDERS })), []);
  assert.deepEqual(structureFindings(scope({ lines: undefined }), config({ folders: FOLDERS })), []);
});

test('el mensaje lista las carpetas válidas, en es y en', () => {
  for (const lang of ['es', 'en']) {
    const line = MESSAGES[lang][RULES.fileOutsideStructure]({ folders: FOLDERS }, lang);
    assert.ok(line.includes('src/app/features') && line.includes('structure'), lang);
  }
});
