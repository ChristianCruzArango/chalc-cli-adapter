// T1 (spec 019, R1, R2) — un cambio sin código que mutar no bloquea; uno con código y sin mutantes, sí.
//
// Encontrado en el E2E de la spec 018: tras `done`, cambiar solo un decorador (`@Header(...)`) y un import
// dio `no-mutants` → BLOQUEADO, porque Stryker, acotado a las líneas de la tarea, no encontró nada que
// mutar. Decisión del usuario: «no aplica» SOLO si ninguna línea cambiada es código, con la misma noción de
// «gramática» que ya usa la duplicación. Hacen falta dos señales a la vez —el reporte sin mutantes y las
// líneas sin código—: una herramienta mal configurada sobre código de verdad sigue bloqueando.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { codeLines } from '../catalog/gate/lib/codelines.mjs';
import { runMutation } from '../catalog/gate/lib/mutation.mjs';
import { summarize } from '../catalog/gate/lib/mutants.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { frameOf } from '../catalog/gate/lib/i18n.mjs';

const numbers = (text) => codeLines(text).map((l) => l.line);

// ── qué es código ─────────────────────────────────────────────────────────────────────────────

test('R1: imports, re-exports, decorators, closers, comments and blanks are not code', () => {
  const text = [
    "import { Controller } from '@nestjs/common';",
    "export * from './x.js';",
    '',
    '// un comentario',
    "@Header('X-Content-Type-Options', 'nosniff')",
    '/* bloque */',
    '});'
  ].join('\n');
  assert.deepEqual(numbers(text), []);
});

test('R1: a decorator over several lines is grammar too, all of it', () => {
  const text = [
    '@Module({',
    '  controllers: [SaludoController],',
    '  providers: [SaludoService, { provide: X, useValue: (1) }],',
    '})',
    'export class SaludoModule {}'
  ].join('\n');
  // `export class X {}` también es gramática para la duplicación: una declaración no se muta, sus cuerpos sí.
  assert.deepEqual(numbers(text), []);
});

test('R1: statements, expressions and assignments are code', () => {
  const text = ['const x = 1;', "  return `Hola, ${n}`;", 'if (a) b();', '  imports: [SaludoModule],'].join('\n');
  assert.deepEqual(numbers(text), [1, 2, 3, 4]);
});

test('R1: a decorator that closes on its own line does not swallow what follows', () => {
  const text = ["@Get()", 'saludar(): string {', '  return this.s.saludar();', '}'].join('\n');
  assert.deepEqual(numbers(text), [2, 3]);
});

test('R1: a decorator left open does not throw, and swallows to the end', () => {
  assert.deepEqual(numbers('@Module({\n  a: 1,\n'), []);
  assert.deepEqual(codeLines(undefined), []);
});

// ── dentro de la etapa ────────────────────────────────────────────────────────────────────────

const CONTROLLER = [
  "import { Controller, Get, Header } from '@nestjs/common';", // 1
  '',                                                           // 2
  "@Controller('saludo')",                                      // 3
  'export class SaludoController {',                            // 4
  '  @Get()',                                                   // 5
  "  @Header('X-Content-Type-Options', 'nosniff')",             // 6
  '  saludar(): string {',                                      // 7
  "    return 'Hola';",                                         // 8
  '  }',                                                        // 9
  '}'                                                           // 10
].join('\n');

async function repo() {
  const root = await mkdtemp(join(tmpdir(), 'chalc-no-code-'));
  for (const [rel, content] of Object.entries({ 'src/saludo.controller.ts': CONTROLLER, 'node_modules/.bin/stryker': '' })) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content, 'utf8');
  }
  return root;
}

// Una corrida de Stryker que no encontró nada que mutar: escribe un reporte fresco y vacío.
const emptyRun = (root) => async () => {
  await new Promise((r) => setTimeout(r, 15));
  await mkdir(join(root, 'reports', 'mutation'), { recursive: true });
  await writeFile(join(root, 'reports', 'mutation', 'mutation.json'), JSON.stringify({ schemaVersion: '1.0', files: {} }), 'utf8');
  return { code: 0, ms: 50 };
};

const CONFIG = { mutation: { tool: 'stryker', command: 'npx --no-install stryker run', report: 'reports/mutation/mutation.json', format: 'elements', probe: 'node_modules/.bin/stryker', scopeFlag: '--mutate', scopeSpan: 'colon', threshold: 80, required: true } };
const mutate = async (changedLines) => {
  const root = await repo();
  return runMutation(CONFIG, { root, changed: ['src/saludo.controller.ts'], lines: new Map([['src/saludo.controller.ts', new Set(changedLines)]]), run: emptyRun(root) });
};

test('R1: a change of only imports and decorators, with no mutants, does not apply', async () => {
  const stage = await mutate([1, 6]);
  assert.deepEqual({ ok: stage.ok, blocked: stage.blocked, skipped: stage.skipped, reason: stage.reason }, { ok: true, blocked: false, skipped: true, reason: 'no-code' });
  assert.ok(stage.command.startsWith(CONFIG.mutation.command), 'the result keeps the command that ran');
  assert.equal(stage.code, 0);
});

test('R2: a change with a line of code and no mutants still blocks', async () => {
  const stage = await mutate([6, 8]);
  assert.equal(stage.blocked, true);
  assert.equal(stage.findings[0].rule, RULES.noMutants);
});

test('R1: the evidence says why it does not apply, in both languages', () => {
  assert.ok(frameOf('es').status.skippedNoCode);
  assert.ok(frameOf('en').status.skippedNoCode);
});

test('R2: without knowing which files the task changed, it still blocks', async () => {
  const root = await repo();
  const stage = await runMutation(CONFIG, { root, changed: [], run: emptyRun(root) });
  assert.equal(stage.blocked, true);
});

test('R2: mutants inside the task that could not be evaluated (compile errors) still block', async () => {
  const root = await repo();
  const invalid = async () => {
    await new Promise((r) => setTimeout(r, 15));
    await mkdir(join(root, 'reports', 'mutation'), { recursive: true });
    await writeFile(join(root, 'reports', 'mutation', 'mutation.json'), JSON.stringify({ schemaVersion: '1.0', files: {
      'src/saludo.controller.ts': { mutants: [{ id: '1', mutatorName: 'StringLiteral', location: { start: { line: 6 } }, status: 'CompileError' }] }
    } }), 'utf8');
    return { code: 0, ms: 50 };
  };
  const stage = await runMutation(CONFIG, { root, changed: ['src/saludo.controller.ts'], lines: new Map([['src/saludo.controller.ts', new Set([1, 6])]]), run: invalid });
  assert.equal(stage.blocked, true);
  assert.equal(stage.findings[0].rule, RULES.noMutants);
});

test('R2: a source file that cannot be read counts as code', async () => {
  const root = await repo();
  const stage = await runMutation(CONFIG, { root, changed: ['src/borrado.ts'], lines: new Map([['src/borrado.ts', new Set([1])]]), run: emptyRun(root) });
  assert.equal(stage.blocked, true);
});

// Los casos de abajo salen de la pasada de mutación.

test('R1: indented, dotted and spaced multi-line decorators are grammar too', () => {
  const text = [
    'class Dto {',
    '  @ApiProperty({',
    "    description: 'nombre',",
    '  })',
    '  @Api.Field({',
    '    required: true,',
    '  })',
    '  @Validate ({',
    '    max: 10,',
    '  })',
    '  nombre = valor;',
    '}'
  ].join('\n');
  assert.deepEqual(numbers(text), [1, 11]);
});

test('R1: the in-scope count includes mutants that could not be evaluated', () => {
  const mutants = [
    { file: 'a.ts', line: 1, status: 'Killed' },
    { file: 'a.ts', line: 2, status: 'CompileError' },
    { file: 'b.ts', line: 1, status: 'Killed' }
  ];
  assert.equal(summarize(mutants, { within: (file) => file === 'a.ts' }).inScope, 2);
  assert.equal(summarize(mutants).inScope, 3);
  assert.equal(summarize([]).inScope, 0);
});

test('R1: test files among the changes are not production code', async () => {
  const root = await repo();
  await writeFile(join(root, 'src/saludo.controller.spec.ts'), "it('x', () => expect(1).toBe(1));\n", 'utf8');
  const stage = await runMutation(CONFIG, {
    root, changed: ['src/saludo.controller.ts', 'src/saludo.controller.spec.ts'],
    lines: new Map([['src/saludo.controller.ts', new Set([6])], ['src/saludo.controller.spec.ts', new Set([1])]]), run: emptyRun(root)
  });
  assert.equal(stage.reason, 'no-code');
});
