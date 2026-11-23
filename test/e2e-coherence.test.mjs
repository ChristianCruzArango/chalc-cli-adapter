// Spec 024 (coherencia), T12 — de punta a punta en un proyecto EQUIPADO, con el CLI real y las herramientas
// que quedan en `.chalc/`: sin spec coherente y aprobada por el usuario, ni el advisor ni el portón dejan pasar.
//
// El repo de git es propio y temporal (CI clona con profundidad 1), los comandos del portón no llevan
// caracteres que `cmd.exe` rechace, y nada espera a ciegas: cada paso es un proceso que termina.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tempDir } from './helpers/tmpdir.mjs';
import { coherentTexts } from './helpers/coherentspec.mjs';
import { specFingerprint } from '../catalog/gate/lib/specprint.mjs';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
const node = (args, cwd) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', input: '', timeout: 120000, env: { ...process.env, CHALC_LANG: 'es' } });
const chalc = (args, cwd) => node([BIN, ...args], cwd);
const git = (args, cwd) => spawnSync('git', ['-c', 'user.name=chalc', '-c', 'user.email=test@chalc.dev', ...args], { cwd, encoding: 'utf8' });
const next = (cwd) => {
  const r = node([join('.chalc', 'next.mjs')], cwd);
  return { action: /^NEXT_ACTION: (\S+)/m.exec(r.stdout)?.[1], command: /^COMMAND: ?(.*)$/m.exec(r.stdout)?.[1] ?? '', reason: /^REASON: (.*)$/m.exec(r.stdout)?.[1] ?? '', out: r.stdout + r.stderr };
};
const gate = (cwd, ...args) => node([join('.chalc', 'gate.mjs'), ...args], cwd);
const SPEC = 'specs/001-pagos';

async function equipped(t) {
  const dir = await tempDir(t, 'chalc-024-e2e-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --version' } }));
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'pago.mjs'), 'export const pago = () => 1;\n');
  const r = chalc([dir, '--yes', '--target', 'claude', '--method', 'sdd:lite', '--lang', 'es'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // El portón de este repo de juguete: un comando de tests inocuo y sin herramienta de mutación que instalar.
  const configFile = join(dir, '.chalc', 'gate.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  await writeFile(configFile, JSON.stringify({ ...config, language: 'es', test: { command: 'node --version' }, mutation: { ...config.mutation, required: false }, pending: [] }, null, 2));
  assert.equal(git(['init', '-q'], dir).status, 0);
  git(['add', '-A'], dir);
  assert.equal(git(['commit', '-q', '-m', 'base'], dir).status, 0);
  return dir;
}

test('equipar deja los dos roles de la spec, el comando chalc-spec y las herramientas de coherencia', async (t) => {
  const dir = await equipped(t);
  for (const rel of ['.claude/agents/especificador.md', '.claude/agents/analista.md', '.claude/skills/chalc-spec/SKILL.md',
    '.chalc/gate/lib/coherence.mjs', '.chalc/gate/lib/specseal.mjs', '.chalc/gate/lib/approvecli.mjs', '.chalc/next/lib/specstage.mjs', 'specs/_template/hu.md']) {
    assert.ok(existsSync(join(dir, ...rel.split('/'))), rel);
  }
  const roles = JSON.parse(readFileSync(join(dir, '.chalc', 'gate.json'), 'utf8')).flow.roles;
  assert.deepEqual(roles.filter((r) => r.cadence === 'spec').map((r) => [r.id, r.kind || 'reviewer']), [['especificador', 'author'], ['analista', 'reviewer']]);
  assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /Puerta de la spec/);
});

test('del proyecto recién equipado a la primera tarea: el advisor y el portón exigen coherencia y la aprobación del usuario', async (t) => {
  const dir = await equipped(t);

  // (a) Sin ninguna spec: lo primero es la HU.
  const first = next(dir);
  assert.equal(first.action, 'fix_specs', first.out);
  assert.match(first.reason, /hu\.md/);

  // (b) `chalc spec --doc` trae la HU; la plantilla sin rellenar todavía no es coherente.
  await writeFile(join(dir, 'historia.md'), '# Pagos\n\nEl sistema cumple el criterio 1 de la historia.\n');
  assert.equal(chalc(['spec', '--name', 'pagos', '--doc', 'historia.md'], dir).status, 0);
  assert.match(readFileSync(join(dir, ...SPEC.split('/'), 'hu.md'), 'utf8'), /Fuente: historia\.md/);
  // La plantilla de diseño no se copia (spec 038): solo existe en una spec con interfaz.
  assert.equal(existsSync(join(dir, ...SPEC.split('/'), 'design.md')), false);
  assert.equal(existsSync(join(dir, ...SPEC.split('/'), 'probes.json')), false);
  assert.ok(existsSync(join(dir, 'specs', '_template', 'design.md')));
  const template = next(dir);
  assert.equal(template.action, 'fix_specs', template.out);
  assert.match(template.reason, /specs\/001-pagos\//);
  assert.equal(gate(dir, '--fast').status, 1, 'el portón tampoco deja pasar');

  // (c) Con los cuatro documentos coherentes, falta quien los revise contra la HU.
  const texts = coherentTexts(['R1']);
  for (const [name, text] of Object.entries(texts)) await writeFile(join(dir, ...SPEC.split('/'), name), text);
  const fingerprint = specFingerprint(texts);
  const review = next(dir);
  assert.equal(review.action, 'call_role', review.out);
  assert.match(review.reason, /analista/);
  assert.ok(review.reason.includes(fingerprint));

  // (d) El analista deja su OK atado a la huella: ahora solo falta el usuario.
  const stamp = new Date(Date.now() - 2000).toISOString().replace(/\.\d+Z$/, 'Z');
  await appendFile(join(dir, '.chalc', 'review.md'), `## ${stamp} · abc1234 · analista · OK\n- Huella: ${fingerprint}\n`);
  const approve = next(dir);
  assert.equal(approve.action, 'approve_spec', approve.out);
  assert.equal(approve.command, 'node .chalc/gate.mjs --approve-spec');

  // (e) El asistente no puede aprobar: sin una terminal interactiva el comando se niega y no sella nada.
  const refused = gate(dir, '--approve-spec');
  assert.equal(refused.status, 2, refused.stdout + refused.stderr);
  assert.equal(existsSync(join(dir, '.chalc', 'seals', '001-pagos.spec.json')), false);
  const blocked = gate(dir, '--fast');
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /--approve-spec/);

  // (f) El usuario aprueba (aquí, con el mismo módulo que usa su comando): se puede trabajar la primera tarea.
  const { writeSeal } = await import(pathToFileURL(join(dir, '.chalc', 'gate', 'lib', 'specseal.mjs')).href);
  const { huHash } = await import(pathToFileURL(join(dir, '.chalc', 'gate', 'lib', 'specprint.mjs')).href);
  await writeSeal(dir, { dir: SPEC, hu: huHash(texts['hu.md']), fingerprint, date: new Date().toISOString() });
  // Lo primero de la tarea son sus tests (spec 030): hasta registrar el rojo, o declarar que no lleva, no hay código.
  const red = next(dir);
  assert.equal(red.action, 'red_task', red.out);
  assert.equal(red.command, 'node .chalc/gate.mjs --red');
  assert.equal(gate(dir, '--red').status, 1, 'sin tests escritos no hay rojo que registrar');
  assert.equal(gate(dir, '--red', '--skip', 'tarea de prueba sin tests').status, 0);
  const work = next(dir);
  assert.equal(work.action, 'work_task', work.out);

  // (g) Tocar la spec después invalida la revisión y la aprobación, para el advisor y para el portón.
  await appendFile(join(dir, ...SPEC.split('/'), 'plan.md'), '\nUn cambio posterior a la aprobación (R1).\n');
  assert.equal(next(dir).action, 'call_role');
  await writeFile(join(dir, 'src', 'pago.mjs'), 'export const pago = () => 2;\n');
  const after = gate(dir, '--fast');
  assert.equal(after.status, 1);
  assert.match(after.stdout, /--approve-spec/);
});

// Spec 028 (puertas humanas), T6 — el otro extremo: con la spec aprobada y todo hecho, el cierre lo aprueba
// el usuario. Los roles de revisión se apagan en este repo de juguete: aquí se prueba la puerta, no el ciclo.
test('del trabajo terminado al cierre: approve_feature hasta que el usuario lo sella; después, done', async (t) => {
  const dir = await equipped(t);
  const configFile = join(dir, '.chalc', 'gate.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  const roles = config.flow.roles.map((role) => ({ ...role, required: false }));
  await writeFile(configFile, JSON.stringify({ ...config, flow: { ...config.flow, roles } }, null, 2));

  // Spec aprobada y con todas sus tareas marcadas (marcar casillas no cambia la huella).
  const texts = coherentTexts(['R1']);
  const fingerprint = specFingerprint(texts);
  await mkdir(join(dir, ...SPEC.split('/')), { recursive: true });
  for (const [name, text] of Object.entries(texts)) await writeFile(join(dir, ...SPEC.split('/'), name), name === 'tasks.md' ? text.replace(/\[ \]/g, '[x]') : text);
  const lib = (name) => import(pathToFileURL(join(dir, '.chalc', 'gate', 'lib', name)).href);
  const { writeSeal } = await lib('specseal.mjs');
  const { huHash } = await lib('specprint.mjs');
  await writeSeal(dir, { dir: SPEC, hu: huHash(texts['hu.md']), fingerprint, date: new Date().toISOString() });

  // Código de la tarea, medido por una corrida COMPLETA del portón.
  await writeFile(join(dir, 'src', 'pago.mjs'), 'export const pago = () => 2;\n');
  assert.equal(next(dir).action, 'run_gate');
  const measured = gate(dir);
  assert.equal(measured.status, 0, measured.stdout + measured.stderr);

  const closing = next(dir);
  assert.equal(closing.action, 'approve_feature', closing.out);
  assert.equal(closing.command, 'node .chalc/gate.mjs --approve-feature');

  // El asistente no puede darlo: sin terminal interactiva se niega y no sella.
  assert.equal(gate(dir, '--approve-feature').status, 2);
  assert.equal(existsSync(join(dir, '.chalc', 'seals', '001-pagos.feature.json')), false);

  // El usuario lo aprueba (aquí, con el mismo módulo que usa su comando).
  const state = JSON.parse(await readFile(join(dir, '.chalc', 'gate.state.json'), 'utf8'));
  await writeSeal(dir, { dir: SPEC, fingerprint, evidence: state.date, head: '', date: new Date().toISOString() }, 'feature');
  assert.equal(next(dir).action, 'done');
});
