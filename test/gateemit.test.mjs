// T3 (R1) — emisión del portón dentro del repo equipado.
// El portón se COPIA (código real de `catalog/gate/`), no se genera con plantillas de texto, y se
// lleva consigo los linters que chalc ya tiene. Invariante que sostiene R18: el árbol emitido no
// importa nada fuera de `.chalc/` — corre con `node .chalc/gate.mjs` aunque chalc no esté instalado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { emitGate, GATE_DIR } from '../lib/gateemit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-emit-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

// Catálogo de origen de mentira: aísla la emisión del contenido real del portón (que llega en el
// bloque B). Lo que se prueba aquí es el mecanismo de copia, no las etapas.
async function fakeCatalog() {
  return project({
    'gate.mjs': "import { lintBoundaries } from './lib/boundaries.mjs';\nimport { readFile } from 'node:fs/promises';\nexport const main = () => lintBoundaries;\n",
    'lib/boundaries.mjs': "export const lintBoundaries = () => [];\n",
    'lib/etapa.mjs': "export const etapa = () => 'ok';\n",
    'lib/otra.mjs': "import { etapa } from './etapa.mjs';\nexport const otra = () => etapa();\n"
  });
}

const jestProject = () => project({
  'package.json': { name: 'x', devDependencies: { jest: '^29.0.0' }, scripts: { test: 'jest' } }
});

// Todos los .mjs bajo una carpeta, en rutas relativas con '/'.
async function modules(dir, rel = '') {
  const out = [];
  for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await modules(dir, child));
    else if (child.endsWith('.mjs')) out.push(child);
  }
  return out;
}

// Coge tanto `import x from '…'` como el `import '…'` suelto del lanzador.
const importsOf = (source) => [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

test('emitGate copies the gate entry and its modules into .chalc/', async () => {
  const proj = await jestProject();

  await emitGate(proj, { sourceDir: await fakeCatalog() });

  assert.ok(existsSync(join(proj, '.chalc', 'gate.mjs')), 'falta la entrada .chalc/gate.mjs');
  assert.ok(existsSync(join(proj, '.chalc', 'gate', 'gate.mjs')), 'falta el portón bajo .chalc/gate/');
  assert.ok(existsSync(join(proj, '.chalc', 'gate', 'lib', 'etapa.mjs')));
  assert.ok(existsSync(join(proj, '.chalc', 'gate', 'lib', 'otra.mjs')));
});

// El árbol se copia tal cual y la entrada de mano es un lanzador: así los imports relativos del
// portón valen igual en el catálogo que en el repo equipado.
test('emitGate leaves .chalc/gate.mjs as a launcher of the copied tree', async () => {
  const proj = await jestProject();

  await emitGate(proj, { sourceDir: await fakeCatalog() });

  const launcher = await readFile(join(proj, '.chalc', 'gate.mjs'), 'utf8');
  assert.deepEqual(importsOf(launcher), ['./gate/gate.mjs']);
});

// Los linters de fronteras y de rutas de contrato viven DENTRO del portón, y `lib/` los re-exporta.
// Así el repo equipado recibe la misma implementación que usa `chalc verify`, no una copia paralela
// que pueda quedarse atrás.
test('emitGate carries the linters chalc already has, instead of reimplementing them', async () => {
  const proj = await jestProject();

  await emitGate(proj, { sourceDir: GATE_DIR });

  for (const name of ['boundaries.mjs', 'contract-routes.mjs']) {
    assert.equal(
      await readFile(join(proj, '.chalc', 'gate', 'lib', name), 'utf8'),
      await readFile(join(GATE_DIR, 'lib', name), 'utf8')
    );
  }
});

test('the chalc-side linters are re-exports, not a second implementation', async () => {
  for (const shim of ['verify-boundaries.mjs', 'contractlint.mjs']) {
    const source = await readFile(join(ROOT, 'lib', shim), 'utf8');
    assert.match(source, /export \{[^}]+\} from '\.\.\/catalog\/gate\/lib\//, `${shim} debe re-exportar el módulo del portón`);
  }
});

test('emitGate copies the gate code verbatim (it is code, not a text template)', async () => {
  const proj = await jestProject();
  const source = await fakeCatalog();

  await emitGate(proj, { sourceDir: source });

  assert.equal(
    await readFile(join(proj, '.chalc', 'gate', 'gate.mjs'), 'utf8'),
    await readFile(join(source, 'gate.mjs'), 'utf8')
  );
});

test('emitGate writes the detected config to .chalc/gate.json', async () => {
  const proj = await jestProject();

  const result = await emitGate(proj, { sourceDir: await fakeCatalog(), role: 'front', language: 'español' });

  const written = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  assert.equal(written.test.command, 'npm test');
  assert.equal(written.mutation.tool, 'stryker');
  assert.equal(written.mutation.threshold, 80);
  assert.equal(written.role, 'front');
  assert.equal(written.language, 'español');
  assert.deepEqual(written, result.config);
});

test('emitGate reports every file it wrote, relative to the project', async () => {
  const proj = await jestProject();

  const { written } = await emitGate(proj, { sourceDir: await fakeCatalog() });

  assert.ok(written.includes('.chalc/gate.mjs'));
  assert.ok(written.includes('.chalc/gate.json'));
  assert.ok(written.includes('.chalc/gate/lib/boundaries.mjs'));
  assert.ok(written.every((p) => p.startsWith('.chalc/')), 'la emisión no debe salirse de .chalc/');
});

// --- T5 (R16) — re-equipar no puede pisar lo que el usuario configuró ---

// Proyecto con un portón ya emitido y su gate.json editado a mano.
async function equipped(edits, { sourceDir } = {}) {
  const proj = await jestProject();
  const source = sourceDir || await fakeCatalog();
  const { config } = await emitGate(proj, { sourceDir: source });
  await writeFile(join(proj, '.chalc', 'gate.json'), JSON.stringify({ ...config, ...edits }, null, 2), 'utf8');
  return { proj, source };
}

test('emitGate keeps the values the user edited in gate.json', async () => {
  const { proj, source } = await equipped({
    test: { command: 'npm run test:ci' },
    mutation: { tool: 'stryker', command: 'npx stryker run --concurrency 2', report: 'out/mutation.json', format: 'elements', install: '', threshold: 60 }
  });

  await emitGate(proj, { sourceDir: source });

  const cfg = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  assert.equal(cfg.test.command, 'npm run test:ci');
  assert.equal(cfg.mutation.command, 'npx stryker run --concurrency 2');
  assert.equal(cfg.mutation.report, 'out/mutation.json');
  assert.equal(cfg.mutation.threshold, 60);
});

test('emitGate adds keys the previous config did not have', async () => {
  const { proj, source } = await equipped({});
  // Config de una versión anterior de chalc: sin límites de lint ni carpeta de specs.
  const old = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  delete old.lint;
  delete old.spec;
  await writeFile(join(proj, '.chalc', 'gate.json'), JSON.stringify(old, null, 2), 'utf8');

  await emitGate(proj, { sourceDir: source });

  const cfg = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  assert.equal(cfg.lint.maxFileLines, 300);
  assert.equal(cfg.spec.dir, 'specs');
});

// `pending` es DERIVADO, no dato del usuario: si llenó a mano lo que la detección no supo,
// el campo deja de estar pendiente. Si siguiera marcado, el portón bloquearía para siempre (R4).
test('emitGate recomputes pending from the merged config', async () => {
  const proj = await project({ 'pubspec.yaml': 'name: x\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n' });
  const source = await fakeCatalog();
  const { config } = await emitGate(proj, { sourceDir: source });
  assert.ok(config.pending.includes('mutation.command'));   // Dart: la detección no sabe

  const filled = { ...config, mutation: { ...config.mutation, tool: 'casero', command: 'dart run tool/mutar.dart', report: 'reports/mutation/dart.json', format: 'elements' } };
  await writeFile(join(proj, '.chalc', 'gate.json'), JSON.stringify(filled, null, 2), 'utf8');

  await emitGate(proj, { sourceDir: source });

  const cfg = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  assert.deepEqual(cfg.pending, []);
});

test('emitGate regenerates the gate code even if it was modified or deleted', async () => {
  const { proj, source } = await equipped({});
  await writeFile(join(proj, '.chalc', 'gate', 'gate.mjs'), '// tocado a mano\n', 'utf8');
  await writeFile(join(proj, '.chalc', 'gate.mjs'), '// lanzador tocado a mano\n', 'utf8');

  await emitGate(proj, { sourceDir: source });

  assert.equal(
    await readFile(join(proj, '.chalc', 'gate', 'gate.mjs'), 'utf8'),
    await readFile(join(source, 'gate.mjs'), 'utf8')
  );
  assert.deepEqual(importsOf(await readFile(join(proj, '.chalc', 'gate.mjs'), 'utf8')), ['./gate/gate.mjs']);
});

test('emitGate falls back to the detected config when gate.json is corrupt', async () => {
  const { proj, source } = await equipped({});
  await writeFile(join(proj, '.chalc', 'gate.json'), '{ esto no es json', 'utf8');

  const { config } = await emitGate(proj, { sourceDir: source });

  assert.equal(config.mutation.threshold, 80);
  assert.equal(config.test.command, 'npm test');
});

// role e idioma NO los edita el usuario: los aporta el equipamiento (qué lado del feature es este
// repo). Un valor explícito del llamador manda; sin valor, se conserva lo que ya había.
test('emitGate lets the caller update role and language, and keeps them when not given', async () => {
  const { proj, source } = await equipped({ role: 'front', language: 'español' });

  await emitGate(proj, { sourceDir: source, role: 'back' });
  let cfg = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  assert.equal(cfg.role, 'back');
  assert.equal(cfg.language, 'español');

  await emitGate(proj, { sourceDir: source });
  cfg = JSON.parse(await readFile(join(proj, '.chalc', 'gate.json'), 'utf8'));
  assert.equal(cfg.role, 'back');
});

// R18 — el portón corre sin chalc instalado: solo builtins de node y rutas relativas dentro de .chalc/.
test('the emitted tree imports nothing outside .chalc/', async () => {
  const proj = await jestProject();

  await emitGate(proj, { sourceDir: await fakeCatalog() });

  const gateDir = join(proj, '.chalc');
  for (const rel of await modules(gateDir)) {
    for (const spec of importsOf(await readFile(join(gateDir, rel), 'utf8'))) {
      const ok = spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../');
      assert.ok(ok, `${rel} importa fuera de .chalc/: ${spec}`);
      if (spec.startsWith('.')) {
        const target = resolve(dirname(join(gateDir, rel)), spec);
        assert.ok(existsSync(target), `${rel} importa un archivo que no se emitió: ${spec}`);
        assert.ok(target.startsWith(gateDir), `${rel} escapa de .chalc/: ${spec}`);
      }
    }
  }
});
