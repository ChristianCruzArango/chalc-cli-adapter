// T10 (spec 022, R15, R17, R18, S7b/F18) — mutantes: la entrada de línea de comandos del portón (`--seal`,
// `--fast`, el resumen por consola), la etapa que bloquea comandos sin re-sellar, el registro de escrituras
// (raíz desde CLAUDE_PROJECT_DIR), el re-sellado de la línea base y las claves que no envenenan la config.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { isEntry, main, report, runGate } from '../catalog/gate/gate.mjs';
import { main as recordMain } from '../catalog/gate/record.mjs';
import { readBaseline, resealConfig, sealBaseline, TASK_REL } from '../catalog/gate/lib/baseline.mjs';
import { commandChanges, guardedConfig } from '../catalog/gate/lib/fingerprint.mjs';
import { envLanguage, loadConfig } from '../catalog/gate/lib/config.mjs';
import { frameOf, messageOf } from '../catalog/gate/lib/i18n.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { readTouched } from '../catalog/gate/lib/touched.mjs';

const NODE_OK = `${JSON.stringify(process.execPath)} -e "process.exit(0)"`;
const CONFIG = {
  stack: 'js',
  test: { command: NODE_OK },
  mutation: { tool: '', command: '', report: '', format: '', threshold: 80, required: false, scopeFlag: '' },
  lint: { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3, duplication: { enabled: false } },
  security: { enabled: false },
  spec: { dir: 'specs' },
  role: 'back',
  language: 'es'
};
const git = (dir, ...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).stdout.trim();

async function files(dir, map) {
  for (const [rel, content] of Object.entries(map)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
}

// Un repo equipado, con commit base y un archivo nuevo de la tarea en curso.
async function repo(t, { config = CONFIG, seal = false } = {}) {
  const dir = await tempDir(t, 'chalc-mut-gate-');
  await files(dir, { '.chalc/gate.json': JSON.stringify(config), 'specs/001-x/spec.md': '- **R1** — WHEN x THE SYSTEM SHALL y.', 'src/base.ts': 'export const base = () => 1;\n' });
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  if (seal) await sealBaseline(dir, { commit: git(dir, 'rev-parse', 'HEAD'), config: guardedConfig((await loadConfig(dir)).config) });
  await files(dir, { 'src/nuevo.ts': 'export const n = 1;\n', '.chalc/task.files': 'src/nuevo.ts\n' });
  return dir;
}

const collector = () => {
  const lines = [];
  return { lines, write: (text) => lines.push(text) };
};

// T10 (spec 022, R15, S7b)
test('S7b: a changed command yields exactly one blocking config stage naming the keys', async (t) => {
  const dir = await repo(t, { seal: true });
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ ...CONFIG, test: { command: 'npm run otro' } }));
  const result = await runGate({ root: dir, run: async () => ({ code: 0, ms: 1 }) });
  assert.deepEqual(result.stages, [{
    stage: 'config', ok: false, blocked: true, reason: RULES.commandsUnsealed, command: '', code: null, ms: 0,
    findings: [{ file: '', line: 0, rule: RULES.commandsUnsealed, data: { keys: ['test.command'] } }]
  }]);
  assert.equal(result.code, 1);
});

// T10 (spec 022, R15, S7b)
test('S7b: --seal from main re-seals, says so in the project language and exits 0', async (t) => {
  const dir = await repo(t, { seal: true });
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ ...CONFIG, test: { command: 'npm run otro' } }));
  const out = collector();
  assert.equal(await main({ argv: ['node', 'gate.mjs', '--seal'], root: dir, write: out.write }), 0);
  assert.deepEqual(out.lines, [frameOf('es').sealed]);
  assert.equal((await readBaseline(dir)).config['test.command'], 'npm run otro');
});

// T10 (spec 022, R15, S7b)
test('S7b: --seal with nothing sealed says there is nothing to re-seal and exits 1', async (t) => {
  const dir = await repo(t);
  const out = collector();
  assert.equal(await main({ argv: ['node', 'gate.mjs', '--seal'], root: dir, write: out.write }), 1);
  assert.deepEqual(out.lines, [frameOf('es').nothingToSeal]);
  assert.equal((await readBaseline(dir)).exists, false);
});

// T10 (spec 022, R15, S7b)
test('S7b: re-sealing without a readable config is refused, and the baseline file keeps a trailing newline', async (t) => {
  const empty = await tempDir(t, 'chalc-mut-gate-none-');
  assert.equal(await resealConfig(empty, { 'test.command': 'x' }), false);
  const dir = await repo(t, { seal: true });
  assert.equal(await resealConfig(dir, { 'test.command': 'y' }), true);
  const text = await readFile(join(dir, TASK_REL), 'utf8');
  assert.ok(text.endsWith('}\n'), JSON.stringify(text.slice(-3)));
  assert.equal(JSON.parse(text).config['test.command'], 'y');
});

// T10 (spec 022, R15, S7b)
test('S7b: commandChanges keeps only the command keys, and nothing when given nothing', () => {
  assert.deepEqual(commandChanges(['lint', 'test.command', 'mutation.command', 'spec.dir']), ['test.command', 'mutation.command']);
  assert.deepEqual(commandChanges(), []);
});

// T10 (spec 022, R15) — la corrida normal desde la CLI
test('main runs the gate: a fast pass warns that it does not close the task; a full pass does not', async (t) => {
  const fastDir = await repo(t);
  const fast = collector();
  assert.equal(await main({ argv: ['node', 'gate.mjs', '--fast'], root: fastDir, write: fast.write }), 0);
  assert.equal(fast.lines.at(-1), `\n${frameOf('es').fast}`);
  assert.match(fast.lines[0], new RegExp(`${frameOf('es').title}: ${frameOf('es').verdict.pass}`));

  const fullDir = await repo(t);
  const full = collector();
  assert.equal(await main({ argv: ['node', 'gate.mjs'], root: fullDir, write: full.write }), 0);
  assert.ok(!full.lines.includes(`\n${frameOf('es').fast}`), full.lines.join('|'));
});

// T10 (spec 022, R15)
test('main without a config blocks with exit 1 and speaks the environment language', async (t) => {
  const dir = await tempDir(t, 'chalc-mut-gate-noconf-');
  const out = collector();
  assert.equal(await main({ argv: ['node', 'gate.mjs'], root: dir, write: out.write }), 1);
  const frame = frameOf(envLanguage());
  assert.match(out.lines[0], new RegExp(`${frame.title}: ${frame.verdict.blocked}`));
});

// T10 (spec 022, R15)
test('the console summary places each finding by file:line, or by the stage label when it has no file', () => {
  const out = collector();
  const result = {
    verdict: 'fail', closesTask: false, evidence: '.chalc/gate.md',
    stages: [
      { stage: 'smells', findings: [{ file: 'src/a.ts', line: 3, rule: RULES.commandsUnsealed, data: { keys: ['k'] } }] },
      { stage: 'config', findings: [{ file: '', line: 0, rule: RULES.commandsUnsealed, data: { keys: ['test.command'] } }] },
      { stage: 'scope', findings: [{ file: '', line: 0, rule: 'x-rule', data: {} }] },
      { stage: 'otra', findings: [{ file: '', line: 0, rule: 'x-rule', data: {} }] }
    ]
  };
  report(result, 'es', out.write);
  assert.deepEqual(out.lines, [
    `\n${frameOf('es').title}: ${frameOf('es').verdict.fail}  ·  .chalc/gate.md`,
    `  src/a.ts:3 — ${messageOf(RULES.commandsUnsealed, { keys: ['k'] }, 'es')}`,
    `  configuración — ${messageOf(RULES.commandsUnsealed, { keys: ['test.command'] }, 'es')}`,
    '  alcance — x-rule',
    '  otra — x-rule'
  ]);
});

// T10 (spec 022, R15)
test('the summary adds the fast-run note only to a pass that does not close the task', () => {
  const lines = (result) => { const out = collector(); report({ evidence: 'e', stages: [], ...result }, 'en', out.write); return out.lines; };
  assert.equal(lines({ verdict: 'pass', closesTask: false }).at(-1), `\n${frameOf('en').fast}`);
  assert.equal(lines({ verdict: 'pass', closesTask: true }).length, 1);
  assert.equal(lines({ verdict: 'fail', closesTask: false }).length, 1);
});

// T10 (spec 022, R15)
test('only a direct invocation of gate.mjs counts as the command-line entry', () => {
  assert.equal(isEntry(['node', '/r/.chalc/gate.mjs']), true);
  assert.equal(isEntry(['node', '/r/.chalc/gate.mjs.bak']), false);
  assert.equal(isEntry(['node', '/r/test/other.mjs']), false);
  assert.equal(isEntry(['node']), false);
});

// T10 (spec 022, R17) — textos del marco y reglas
test('the config and scope stages, and the seal messages, are labelled in both languages', () => {
  const es = frameOf('es');
  const en = frameOf('en');
  assert.deepEqual([es.stages.scope, es.stages.config, en.stages.scope, en.stages.config], ['alcance', 'configuración', 'scope', 'config']);
  for (const frame of [es, en]) {
    assert.match(frame.sealed, /\S{4,}/);
    assert.match(frame.nothingToSeal, /task\.json/);
    assert.notEqual(frame.sealed, frame.nothingToSeal);
  }
  assert.notEqual(es.sealed, en.sealed);
  assert.notEqual(es.nothingToSeal, en.nothingToSeal);
});

// T10 (spec 022, R17)
test('the unsealed-command and folder-grep reasons name their data and the way out, in both languages', () => {
  for (const lang of ['es', 'en']) {
    const unsealed = messageOf(RULES.commandsUnsealed, { keys: ['test.command', 'build.command'] }, lang);
    assert.match(unsealed, /\(test\.command, build\.command\)/);
    assert.match(unsealed, /node \.chalc\/gate\.mjs --seal/);
    assert.match(unsealed, /\.chalc\/gate\.json/);
    const grep = messageOf(RULES.guardSecretGrep, { path: 'src/x' }, lang);
    assert.match(grep, /`src\/x`/);
    assert.match(grep, /`Grep`/);
    assert.match(grep, /`\.env`/);
  }
});

// T10 (spec 022, R17)
test('every rule code is a distinct, non-empty kebab-case string', () => {
  const codes = Object.values(RULES);
  for (const code of codes) assert.match(code, /^[a-z][a-z0-9-]*$/, code);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(RULES.commandsUnsealed, 'commands-unsealed');
  assert.equal(RULES.guardSecretGrep, 'secret-grep');
});

// T10 (spec 022, R17, S9)
test('S9: constructor and prototype keys in gate.json are dropped, not merged', async (t) => {
  const dir = await tempDir(t, 'chalc-mut-gate-keys-');
  await files(dir, { '.chalc/gate.json': '{"constructor":{"injected":1},"prototype":{"injected":2},"test":{"constructor":5,"command":"npm test"}}' });
  const { config } = await loadConfig(dir);
  assert.equal(Object.hasOwn(config, 'constructor'), false);
  assert.equal(Object.hasOwn(config, 'prototype'), false);
  assert.equal(Object.hasOwn(config.test, 'constructor'), false);
  assert.equal(config.test.command, 'npm test');
});

// T10 (spec 022, R18, F18) — el registro de escrituras
test('F18: the recorder takes the root from CLAUDE_PROJECT_DIR over the shell folder', async (t) => {
  const dir = await tempDir(t, 'chalc-mut-record-');
  const target = join(dir, 'src', 'a.ts');
  const read = async () => JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target } });
  assert.deepEqual(await recordMain({ argv: [], env: { CLAUDE_PROJECT_DIR: dir }, cwd: join(dir, 'sub'), read }), ['src/a.ts']);
  assert.deepEqual((await readTouched(dir)).files, ['src/a.ts']);
});

// T10 (spec 022, R18, F18)
test('F18: without CLAUDE_PROJECT_DIR the recorder falls back to the shell folder', async (t) => {
  const dir = await tempDir(t, 'chalc-mut-record-cwd-');
  const read = async () => JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'src', 'b.ts') } });
  assert.deepEqual(await recordMain({ argv: [], env: {}, cwd: dir, read }), ['src/b.ts']);
});

// T10 (spec 022, R18, F18)
test('F18: paths given as arguments are recorded without waiting on stdin', async (t) => {
  const dir = await tempDir(t, 'chalc-mut-record-argv-');
  let asked = false;
  const read = async () => { asked = true; return ''; };
  assert.deepEqual(await recordMain({ argv: [join(dir, 'src', 'c.ts')], env: { CLAUDE_PROJECT_DIR: dir }, cwd: dir, read }), ['src/c.ts']);
  assert.equal(asked, false);
});

// T10 (spec 022, R18, F18)
test('F18: a failure while recording never escapes the hook', async (t) => {
  const dir = await tempDir(t, 'chalc-mut-record-fail-');
  const read = async () => { throw new Error('stdin roto'); };
  assert.deepEqual(await recordMain({ argv: [], env: { CLAUDE_PROJECT_DIR: dir }, cwd: dir, read }), []);
});

// T10 (spec 022, R15, S7b)
test('S7b: with gate.json gone, --seal refuses and the sealed commands stay as they were', async (t) => {
  const dir = await repo(t, { seal: true });
  const { rm } = await import('node:fs/promises');
  await rm(join(dir, '.chalc', 'gate.json'));
  const out = collector();
  assert.equal(await main({ argv: ['node', 'gate.mjs', '--seal'], root: dir, write: out.write }), 1);
  assert.equal((await readBaseline(dir)).config['test.command'], NODE_OK);
});

// T10 (spec 022, R15)
test('an empty language in gate.json falls back to English, for --seal and for the summary', async (t) => {
  const dir = await repo(t, { config: { ...CONFIG, language: '' } });
  const seal = collector();
  await main({ argv: ['node', 'gate.mjs', '--seal'], root: dir, write: seal.write });
  assert.deepEqual(seal.lines, [frameOf('en').nothingToSeal]);
  const run = collector();
  await main({ argv: ['node', 'gate.mjs', '--fast'], root: dir, write: run.write });
  assert.equal(run.lines.at(-1), `\n${frameOf('en').fast}`);
});
