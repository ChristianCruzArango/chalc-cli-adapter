// test/debate-command.test.mjs — specs/014-debate R3, R6, R7, R15, R20, R23, R26, R27, R28, R30.
//
// El comando se prueba de dos maneras y por un motivo: los caminos que NO deben gastar tokens se
// lanzan de verdad (proceso aparte, con un HOME de mentira para no tocar la config del usuario), y la
// escritura del informe se prueba llamando a la función, porque un debate real cuesta dinero.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDebateOutput } from '../lib/commands/debate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(ROOT, 'bin/chalc.mjs');

// Un HOME temporal con la config que le pongamos: los tests no pueden leer —ni tocar— la del usuario,
// y menos disparar una llamada de verdad con su key.
async function fakeHome(config) {
  const home = await mkdtemp(join(tmpdir(), 'chalc-debate-'));
  await mkdir(join(home, '.chalc'), { recursive: true });
  await writeFile(join(home, '.chalc', 'config.json'), JSON.stringify(config ?? {}), 'utf8');
  return home;
}

function runChalc(args, { home, cwd = ROOT } = {}) {
  const env = { ...process.env, CHALC_LANG: 'es', HOME: home, USERPROFILE: home };
  delete env.CHALC_API_KEY;   // que ninguna variable del entorno real se cuele en un test
  delete env.CHALC_PROVIDER;
  return new Promise((res) => {
    execFile(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' }, (error, stdout, stderr) => {
      res({ code: error?.code ?? 0, output: `${stdout}${stderr}` });
    });
  });
}

const CONFIG_CON_PARTICIPANTES = {
  lang: 'es',
  provider: 'openrouter',
  apiKey: 'sk-or-DEMENTIRA',
  model: 'anthropic/claude-sonnet-4.6',
  cli: { rolesFor: 'openrouter', roles: { debateA: 'x-ai/grok-4', debateB: 'anthropic/claude-opus-4.8' } }
};

test('sin idea no se gasta una sola llamada: falla y dice cómo se usa (R7)', async () => {
  const home = await fakeHome(CONFIG_CON_PARTICIPANTES);
  const r = await runChalc(['debate', '--yes'], { home });

  assert.equal(r.code, 1);
  assert.match(r.output, /idea/i);
});

test('sin participantes configurados y sin terminal, dice el comando exacto y no llama (R3)', async () => {
  const home = await fakeHome({ lang: 'es', provider: 'openrouter', apiKey: 'sk-or-DEMENTIRA', model: 'm' });
  const r = await runChalc(['debate', 'una idea cualquiera', '--yes'], { home });

  assert.equal(r.code, 1);
  assert.match(r.output, /config-ia debate/);
});

test('--rounds inválido se rechaza antes de nada (R15)', async () => {
  const home = await fakeHome(CONFIG_CON_PARTICIPANTES);
  for (const n of ['0', '-2', 'dos']) {
    const r = await runChalc(['debate', 'una idea', '--rounds', n, '--yes'], { home });
    assert.equal(r.code, 1, `--rounds ${n} debería fallar`);
    assert.match(r.output, /rounds/i);
  }
});

test('--dry-run enseña participantes y coste, sin llamar ni escribir (R27, R28)', async () => {
  const home = await fakeHome(CONFIG_CON_PARTICIPANTES);
  const cwd = await mkdtemp(join(tmpdir(), 'chalc-debate-cwd-'));
  const r = await runChalc(['debate', 'una cola de eventos para el checkout', '--dry-run', '--yes'], { home, cwd });

  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /x-ai\/grok-4/);
  assert.match(r.output, /anthropic\/claude-opus-4\.8/);
  assert.match(r.output, /9 llamadas/);                          // 2×3 rondas + acta (sin aclaración: --yes, R34)
  assert.deepEqual(await readdir(cwd), []);                 // ni un archivo
});

test('--dry-run con más rondas recalcula el coste y avisa de que a partir de la tercera se repite (R15, R28)', async () => {
  const home = await fakeHome(CONFIG_CON_PARTICIPANTES);
  const r = await runChalc(['debate', 'una idea', '--rounds', '5', '--dry-run', '--yes'], { home });

  assert.equal(r.code, 0, r.output);
  assert.match(r.output,  /13 llamadas/);     // 2×5 rondas + acta, sin aclaración (R34)
  assert.match(r.output, /5/);
});

test('avisa cuando los dos lados son el mismo modelo, pero no bloquea (R4)', async () => {
  const home = await fakeHome({
    ...CONFIG_CON_PARTICIPANTES,
    cli: { rolesFor: 'openrouter', roles: { debateA: 'x-ai/grok-4', debateB: 'x-ai/grok-4' } }
  });
  const r = await runChalc(['debate', 'una idea', '--dry-run', '--yes'], { home });

  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /mismo modelo/i);
});

// ── la escritura del entregable (sin IA) ───────────────────────────────────────────────────────
const estado = (over = {}) => ({
  idea: 'una cola de eventos para el checkout',
  participants: {
    a: { id: 'a', stance: 'proponent', model: 'x-ai/grok-4', provider: 'openrouter' },
    b: { id: 'b', stance: 'challenger', model: 'gpt-oss:20b', provider: 'ollama' }
  },
  rounds: 3, roundsRun: 2,
  turns: [{ round: 1, by: 'a', stance: 'proponent', postura: 'ARGUMENTO', acuerdos: [], desacuerdos: [], resueltos: [], preguntas: [], declaraAcuerdo: false, raw: '===POSTURA===\nARGUMENTO' }],
  questions: [], desacuerdosAbiertos: [], desacuerdosResueltos: [],
  closedBy: 'limit', error: null, synthesis: '===RESUMEN===\nsalió bien', judgment: null, warnings: [],
  ...over
});

test('escribe final.md, debate.md y debate.json en .chalc/debate/NNN-slug y devuelve la ruta (R23, R45)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'chalc-debate-out-'));
  const { dir, files } = await writeDebateOutput({ root: cwd, state: estado(), meta: { generatedAt: '2026-08-22T10:00:00.000Z' } });

  assert.deepEqual((await readdir(dir)).sort(), ['debate.json', 'debate.md', 'final.md']);
  assert.match(dir.replace(/\\/g, '/'), /\.chalc\/debate\/001-una-cola-de-eventos/);
  assert.equal(files.length, 3);

  assert.match(await readFile(join(dir, 'final.md'), 'utf8'), /cola de eventos/);
  assert.match(await readFile(join(dir, 'debate.md'), 'utf8'), /ARGUMENTO/);
  const rec = JSON.parse(await readFile(join(dir, 'debate.json'), 'utf8'));
  assert.equal(rec.participants.b.provider, 'ollama');
});

test('dos debates sobre la MISMA idea son dos carpetas: el primero no se pisa (R26)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'chalc-debate-out-'));
  const meta = { generatedAt: '2026-08-22T10:00:00.000Z' };
  const uno = await writeDebateOutput({ root: cwd, state: estado(), meta });
  await writeFile(join(uno.dir, 'final.md'), 'INFORME ORIGINAL', 'utf8');
  const dos = await writeDebateOutput({ root: cwd, state: estado(), meta });

  assert.notEqual(uno.dir, dos.dir);
  assert.match(dos.dir.replace(/\\/g, '/'), /002-una-cola-de-eventos/);
  assert.equal(await readFile(join(uno.dir, 'final.md'), 'utf8'), 'INFORME ORIGINAL');
});

test('un debate roto igual deja su informe parcial escrito (R30)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'chalc-debate-out-'));
  const roto = estado({ closedBy: 'error', synthesis: '', error: { round: 1, by: 'b', message: 'API 503' } });
  const { dir } = await writeDebateOutput({ root: cwd, state: roto, meta: { generatedAt: '2026-08-22T10:00:00.000Z' } });

  const informe = await readFile(join(dir, 'final.md'), 'utf8');
  assert.match(informe, /503/);
  assert.match(informe, /PARCIAL|PARTIAL/i);
});

test('--out manda: el informe se escribe donde el usuario diga (R23)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'chalc-debate-out-'));
  const destino = join(cwd, 'informes', 'mi-debate');
  const { dir } = await writeDebateOutput({ root: cwd, out: destino, state: estado(), meta: { generatedAt: '' } });

  assert.equal(dir, destino);
  assert.ok((await readdir(destino)).includes('final.md'));
});

// ── coste acotado (R33, R34, R37) ──────────────────────────────────────────────────────────────

test('sin terminal, el coste anunciado ya NO incluye la ronda de aclaración (R34, R37)', async () => {
  const home = await fakeHome(CONFIG_CON_PARTICIPANTES);
  const r = await runChalc(['debate', 'una idea corta', '--dry-run', '--yes'], { home });

  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /9 llamadas/);                       // 2×3 rondas + acta, sin las 2 de aclaración
  assert.match(r.output, /aclaraci/i);                   // y se dice por qué
});

test('--questions fuerza la aclaración aunque nadie vaya a responder (R34)', async () => {
  const home = await fakeHome(CONFIG_CON_PARTICIPANTES);
  const r = await runChalc(['debate', 'una idea corta', '--questions', '--dry-run', '--yes'], { home });

  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /11 llamadas/);
});

test('una idea larga suma la llamada de compresión al coste anunciado (R35, R37)', async () => {
  const home = await fakeHome(CONFIG_CON_PARTICIPANTES);
  const idea = 'historia de usuario con criterios de aceptacion y reglas de negocio. '.repeat(40);
  const r = await runChalc(['debate', idea, '--dry-run', '--yes'], { home });

  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /10 llamadas/);                       // 7 + 1 de comprimir la idea
});

test('--budget inválido se rechaza antes de gastar (R33)', async () => {
  const home = await fakeHome(CONFIG_CON_PARTICIPANTES);
  for (const n of ['0', '999', 'mucho']) {
    const r = await runChalc(['debate', 'una idea', '--budget', n, '--yes'], { home });
    assert.equal(r.code, 1, `--budget ${n} debería fallar`);
    assert.match(r.output, /budget/i);
  }
});

test('--budget válido se anuncia junto al coste (R33)', async () => {
  const home = await fakeHome(CONFIG_CON_PARTICIPANTES);
  const r = await runChalc(['debate', 'una idea', '--budget', '20000', '--dry-run', '--yes'], { home });

  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /20000/);
});

// ── de dónde sale la idea (R6) ─────────────────────────────────────────────────────────────────

test('la idea puede venir de un documento con --doc, también sin terminal (R6)', async () => {
  const home = await fakeHome(CONFIG_CON_PARTICIPANTES);
  const cwd = await mkdtemp(join(tmpdir(), 'chalc-debate-doc-'));
  const doc = join(cwd, 'idea.md');
  await writeFile(doc, '# Canchas\n\nUna app para reservar canchas de fútbol por horas con pago dividido.', 'utf8');

  const r = await runChalc(['debate', '--doc', doc, '--dry-run', '--yes'], { home, cwd });

  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /llamadas/);          // llegó a calcular el coste: hubo idea
  assert.doesNotMatch(r.output, /No hay idea/);
});

test('sin idea, sin argumento y sin flags sigue fallando limpio (R7)', async () => {
  const home = await fakeHome(CONFIG_CON_PARTICIPANTES);
  const r = await runChalc(['debate', '--dry-run', '--yes'], { home });

  assert.equal(r.code, 1);
  assert.match(r.output, /idea/i);
});
