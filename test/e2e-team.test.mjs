// Spec 043 (cierre), T1 y T2 — el carril entero en un proyecto equipado, con las herramientas EMITIDAS (R1–R3).
// Cada pieza tiene sus tests contra el catálogo; aquí corre lo que de verdad ejecuta un proyecto: las copias de
// `.chalc/`, que se importan entre sí. Las firmas de revisión las escribe la prueba: se comprueba el carril y sus
// puertas, no a un modelo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { git, specFiles, writeFiles } from './helpers/teamrepo.mjs';
import { equipForSpec } from '../lib/commands/equip.mjs';
import { toolingDrift } from '../lib/tooldrift.mjs';

const SPEC = 'specs/001-checkout';
// La herramienta emitida, corrida como la corre un rol: `node .chalc/<nombre>.mjs …` en `cwd`.
const tool = (cwd, name, ...args) => {
  const run = spawnSync(process.execPath, [join('.chalc', `${name}.mjs`), ...args], { cwd, encoding: 'utf8', timeout: 120000 });
  return { code: run.status, text: `${run.stdout || ''}${run.stderr || ''}` };
};
// Los commits de la prueba van sin hooks: aquí se prueba el carril del equipo, no el portón de cada commit.
const commit = (cwd, message) => { git(cwd, 'add', '-A'); assert.equal(git(cwd, 'commit', '-q', '--no-verify', '-m', message).status, 0, message); return git(cwd, 'rev-parse', 'HEAD').out; };
const sign = (dir, roles, head) => writeFiles(dir, { '.chalc/review.md': `# Bitácora\n\n${roles.map((role) => `## 2026-11-22T10:05:00Z · ${head.slice(0, 10)} · ${role} · OK\n\n- revisado\n`).join('\n')}` });

// Un proyecto equipado de verdad, con una spec aprobada por «el usuario» y commiteada.
async function project(t) {
  const base = await tempDir(t, 'chalc-043-e2e-');
  const root = join(base, 'repo');
  await writeFiles(root, { 'package.json': JSON.stringify({ name: 'tienda', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }), 'src/index.js': 'module.exports = {};\n' });
  assert.equal(git(root, 'init', '-q').status, 0);
  for (const [key, value] of [['user.name', 'chalc'], ['user.email', 'test@chalc.dev'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(root, 'config', key, value);
  await equipForSpec(root, 'lite', 'claude', { specLang: 'es' });
  // Las pruebas del proyecto, para la unión: un comando que existe en cualquier máquina.
  const gate = JSON.parse(await readFile(join(root, '.chalc', 'gate.json'), 'utf8'));
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ ...gate, test: { command: 'node --version' } }, null, 2));
  await writeFiles(root, specFiles('001-checkout', { touches: ['src/checkout/**'] }));
  commit(root, 'proyecto equipado y spec aprobada');
  return { base, root };
}

test('R1, R3: una spec recorre el carril entero con las herramientas emitidas', async (t) => {
  const { base, root } = await project(t);
  const team = (...args) => tool(root, 'team', ...args);
  const ok = (out) => { assert.equal(out.code, 0, out.text); return out; };

  // Abrir, programar y empezar: worktree y rama propios.
  ok(team('open', '--feature', 'pagos', '--agent', 'claude', SPEC));
  ok(team('waves', '--feature', 'pagos'));
  ok(team('start', '--spec', SPEC));
  const wt = join(base, 'repo.chalc-wt', '001-checkout');
  assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').out, 'chalc/001-checkout');

  // Despachar al desarrollador: la orden trae sus instrucciones, las reglas del proyecto y sus skills.
  const dispatched = ok(team('dispatch', '--spec', SPEC, '--role', 'desarrollador'));
  assert.match(dispatched.text, /nativo.*medio/s);
  const order = await readFile(join(root, '.chalc', 'team', 'orders', '001-checkout.desarrollador.md'), 'utf8');
  for (const piece of ['.chalc/roles/desarrollador.md', '`CLAUDE.md`', '`clean-code`', `${SPEC}/tasks.md`]) assert.ok(order.includes(piece), piece);

  // El desarrollador trabaja en SU worktree. Una entrega sin evidencia se niega; con ella, entra.
  await writeFiles(wt, { 'src/checkout/total.js': 'exports.total = (items) => items.length;\n' });
  commit(wt, 'checkout');
  const early = tool(wt, 'team', 'deliver', '--spec', SPEC);
  assert.equal(early.code, 1, 'sin tareas marcadas ni portón no hay entrega');
  await passGateNoHooks(wt);
  const head = git(wt, 'rev-parse', 'HEAD').out;
  ok(tool(wt, 'team', 'deliver', '--spec', SPEC));

  // Veredicto: sin firmas no cuenta la palabra de nadie; con las dos, revisada.
  assert.equal(team('verdict', '--spec', SPEC).code, 1);
  await sign(wt, ['seguridad', 'revisor'], head);
  ok(team('verdict', '--spec', SPEC));

  // Integrar en la rama de integración; la del usuario no se toca.
  const before = git(root, 'rev-parse', 'HEAD').out;
  ok(team('integrate', '--feature', 'pagos'));
  const int = join(base, 'repo.chalc-wt', 'int-pagos');
  assert.ok(existsSync(join(int, 'src', 'checkout', 'total.js')));
  assert.equal(git(root, 'rev-parse', 'HEAD').out, before);

  // Cierre: el rol de cierre firma sobre lo integrado, y la fusión queda esperando al usuario.
  assert.equal(team('close', '--feature', 'pagos').code, 1, 'falta el rol de cierre');
  ok(team('dispatch', '--spec', SPEC, '--role', 'endurecedor'));
  await sign(int, ['endurecedor'], git(int, 'rev-parse', 'HEAD').out);
  const asked = ok(team('close', '--feature', 'pagos'));
  assert.match(asked.text, /git merge chalc\/int-pagos/);
  assert.match(team('status').text, /Espera al usuario.*git merge chalc\/int-pagos/s);

  // El usuario fusiona en su terminal: eso ES aprobar el cierre.
  assert.equal(git(root, 'merge', '--no-edit', '--no-verify', 'chalc/int-pagos').status, 0);
  ok(team('close', '--feature', 'pagos'));
  assert.match(team('status').text, /cerrada/);

  // El informe y los evals salen del registro de este recorrido.
  const report = ok(team('report', '--feature', 'pagos')).text;
  assert.ok(report.includes(SPEC) && report.includes('integrada') && report.includes('Nada pendiente'), report);
  const evals = JSON.parse(ok(team('evals', '--json')).text);
  assert.deepEqual([evals.specs, evals.integrated, evals.developers.map((d) => [d.tier, d.deliveries, d.firstPass]), evals.integration.merged], [1, 1, [['medio', 1, 1]], 1]);
});

// Como `passGate`, pero commiteando sin hooks (el proyecto equipado tiene los suyos instalados).
async function passGateNoHooks(wt) {
  const tasks = join(wt, ...SPEC.split('/'), 'tasks.md');
  await writeFile(tasks, (await readFile(tasks, 'utf8')).replace(/\[ \]/g, '[x]'));
  const head = git(wt, 'rev-parse', 'HEAD').out;
  await writeFiles(wt, { '.chalc/gate.state.json': JSON.stringify({ date: '2026-11-22T10:00:00.000Z', verdict: 'pass', fast: false, head, stages: [{ stage: 'mutation', ok: true, score: 91 }] }), '.chalc/gate.md': '# portón\n' });
  return commit(wt, 'portón');
}

test('R2: cada herramienta emitida corre con Node a secas en el proyecto, y verify detecta si se altera', async (t) => {
  const { root } = await project(t);
  const runs = [['team', ['status'], 0, /Equipo/], ['design', ['contract'], 0, /"minGap": 8/], ['probe', [], 1, /probe\.mjs run --spec/], ['evals', ['list'], 0, /test-aflojado/],
    ['memory', ['candidates'], 0, /./], ['next', [], null, /./]];
  for (const [name, args, code, output] of runs) {
    const out = tool(root, name, ...args);
    if (code !== null) assert.equal(out.code, code, `${name}: ${out.text}`);
    assert.match(out.text, output, name);
    assert.equal(/ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError/.test(out.text), false, `${name}: ${out.text}`);
  }
  assert.deepEqual(await toolingDrift(root), []);
  for (const rel of ['team/lib/reduce.mjs', 'design/lib/evaluate.mjs', 'probe/lib/expect.mjs', 'evals/lib/checks.mjs', 'evals/cases/test-aflojado.json']) {
    const file = join(root, '.chalc', ...rel.split('/'));
    const original = await readFile(file, 'utf8');
    await writeFile(file, `${original}\n`);
    assert.deepEqual(await toolingDrift(root), [`.chalc/${rel}`], rel);
    await writeFile(file, original);
  }
});
