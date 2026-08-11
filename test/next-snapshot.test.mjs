// T10 (R8, R11) — el único módulo del advisor que toca el mundo.
//
// Todo lo demás es puro a propósito: `decide` no puede equivocarse por culpa del disco. La contra
// es que TODO el riesgo de I/O se concentra aquí, y este módulo tiene una obligación que el resto
// no tiene — no romperse. Un advisor que revienta con un stack trace deja al asistente sin
// siguiente paso, que es peor que no tener advisor (R11).
//
// Y una prohibición: es de SOLO LECTURA (R8). El advisor no marca la tarea, no toca la evidencia y
// no crea nada. Si escribiera, dejaría de ser un observador del estado para pasar a ser parte de él.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshot } from '../catalog/next/lib/snapshot.mjs';
import { recordTouched } from '../catalog/gate/lib/touched.mjs';

const SPEC = 'specs/008-advisor';

// Un repo equipado de mentira: lo mínimo que el advisor necesita leer.
async function repo({ tasks, state, review, config, sourceAt } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-next-'));
  await mkdir(join(root, '.chalc'), { recursive: true });
  await mkdir(join(root, SPEC), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });

  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify(config ?? { spec: { dir: 'specs' }, pending: [] }));
  if (tasks !== null) await writeFile(join(root, SPEC, 'tasks.md'), tasks ?? '- [x] T1\n- [ ] T2 — en esto voy\n');
  if (state) await writeFile(join(root, '.chalc', 'gate.state.json'), JSON.stringify(state));
  if (review) await writeFile(join(root, '.chalc', 'review.md'), review);

  await writeFile(join(root, 'src', 'pago.ts'), 'export const x = 1;\n');
  if (sourceAt) await utimes(join(root, 'src', 'pago.ts'), sourceAt / 1000, sourceAt / 1000);

  // El registro de lo que la tarea escribió (spec 013, R10). Antes el fixture no lo tenía: el
  // temporal no es un repo de git y `changedFiles` caía al árbol de fuentes entero, así que
  // src/pago.ts entraba "gratis". Ese respaldo lo quitó R4b —sin forma de saber qué tocó la tarea,
  // la respuesta es "no sé", nunca el proyecto— y el fixture pasa a decir explícitamente lo que un
  // repo equipado sí sabe: qué archivo escribió esta tarea.
  await recordTouched(root, ['src/pago.ts']);

  return root;
}

const take = (root, over = {}) => snapshot(root, over);

// ── T12 (spec 013, R8): la frescura se mide contra el alcance de la tarea ─────────────────────
//
// El advisor decide "hay trabajo sin medir" comparando la fecha del fuente más reciente con la de la
// evidencia. Si esa comparación mira archivos que no son de esta tarea, el advisor manda a correr el
// portón por trabajo ajeno —una y otra vez, porque ese archivo no se va a arreglar solo— y la
// evidencia buena de hoy queda invalidada por algo que nadie tocó en esta tarea.

test('R8 — a file outside the task scope does not invalidate the evidence', async () => {
  const root = await repo();
  // Ajeno: más reciente que todo, pero no está en el registro de lo que esta tarea escribió.
  await writeFile(join(root, 'src', 'ajeno.ts'), 'export const a = 1;\n');

  const s = await take(root);

  assert.deepEqual(s.changed.files, ['src/pago.ts']);
  assert.ok(s.changed.newestMtime > 0, 'la frescura sale del archivo de la tarea');
});

// De dónde salió el alcance viaja también al advisor: es lo que le permite explicar por qué manda a
// medir, y lo que hace comprobable su decisión.
test('R8 — the snapshot carries where the scope came from', async () => {
  const s = await take(await repo());

  assert.equal(s.changed.source, 'registry');
  assert.equal(s.changed.undetermined, false);
});

// Sin poder saber qué cambió la tarea, el advisor NO puede concluir. "Cero archivos" y "no sé qué
// archivos" llevan a acciones opuestas: la primera dice que no hay trabajo pendiente y podría cerrar
// la feature; la segunda es justo el caso en el que hay que parar y preguntar (R11 de la spec 008).
test('R8 — an undetermined scope is a problem, not an empty list', async () => {
  const root = await repo();
  await rm(join(root, '.chalc', 'task.files'), { force: true });

  const s = await take(root);

  assert.equal(s.changed.undetermined, true);
  assert.ok(s.problems.length > 0, 'el advisor tiene que poder parar y preguntar');
});

// ── arma los hechos que decide necesita ───────────────────────────────────────────────────────

test('R8 — el snapshot trae las seis familias de hechos que decide consume', () => {
  return repo().then(async (root) => {
    const s = await take(root);
    for (const key of ['tasks', 'gate', 'review', 'changed', 'flow', 'git']) {
      assert.ok(s[key] && typeof s[key] === 'object', `falta ${key} en el snapshot`);
    }
    assert.ok(Array.isArray(s.problems), 'problems siempre es una lista');
  });
});

test('R21 — lee el tasks.md de la spec vigente', async () => {
  const root = await repo({ tasks: '- [x] T1\n- [x] T2\n- [ ] T3 — la que toca\n' });
  const s = await take(root);

  assert.equal(s.tasks.hasTasksFile, true);
  assert.deepEqual({ done: s.tasks.done, total: s.tasks.total }, { done: 2, total: 3 });
  assert.equal(s.tasks.current, 'T3 — la que toca');
  assert.ok(s.tasks.mtime > 0, 'la fecha de tasks.md es el discriminador de tick_task');
});

test('R11 — sin tasks.md lo dice en vez de fingir una feature terminada', async () => {
  const root = await repo({ tasks: null });
  const s = await take(root);

  assert.equal(s.tasks.hasTasksFile, false);
  assert.equal(s.tasks.total, 0);
});

test('R13 — sin estado del portón no hay evidencia', async () => {
  const s = await take(await repo());
  assert.equal(s.gate.exists, false);
});

test('R13 — con estado del portón, lo lee', async () => {
  const root = await repo({
    state: { date: '2026-08-09T14:32:11Z', verdict: 'pass', fast: false, branch: 'feature/008-advisor' }
  });
  const s = await take(root);

  assert.equal(s.gate.exists, true);
  assert.equal(s.gate.verdict, 'pass');
  assert.equal(s.gate.date, Date.parse('2026-08-09T14:32:11Z'));
});

test('R16 — con bitácora del revisor, lee la última entrada', async () => {
  const root = await repo({ review: '## 2026-08-09T15:04:02Z · f6e5d4c3b2 · revisor · OK\n' });
  const s = await take(root);

  assert.equal(s.review.exists, true);
  assert.equal(s.review.ok, true);
});

test('R13 — los cambiados traen la fecha del fuente MÁS reciente', async () => {
  const when = Date.parse('2026-08-09T12:00:00Z');
  const root = await repo({ sourceAt: when });
  const s = await take(root);

  assert.ok(s.changed.files.includes('src/pago.ts'));
  assert.equal(s.changed.newestMtime, when);
});

test('R13 — sin archivos cambiados, la fecha más reciente es 0 y no un instante inventado', async () => {
  const s = await take(await repo(), { changed: async () => [] });
  assert.deepEqual({ files: s.changed.files, newestMtime: s.changed.newestMtime }, { files: [], newestMtime: 0 });
  assert.equal(s.changed.undetermined, false, 'cero archivos es una respuesta, no una duda');
});

// Un lector inyectado que devuelve la lista pelada —sin la forma de alcance— sigue valiendo: es una
// respuesta determinada, y sus archivos son los que se miden. Los tests del advisor lo usan para no
// depender de git, y romper esa puerta los volvería frágiles sin ganar nada.
test('R13 — a plain list of files from an injected reader is a determined scope', async () => {
  const s = await take(await repo(), { changed: async () => ['src/pago.ts'] });

  assert.deepEqual(s.changed.files, ['src/pago.ts']);
  assert.ok(s.changed.newestMtime > 0);
  assert.equal(s.changed.undetermined, false);
});

test('R17 — las puertas salen de gate.json, con los defaults del portón si no están', async () => {
  const s = await take(await repo());
  assert.equal(typeof s.flow.approvals.task, 'boolean');
  assert.equal(typeof s.flow.review.required, 'boolean');
});

test('R9 — los campos pendientes de gate.json llegan al snapshot', async () => {
  const root = await repo({ config: { spec: { dir: 'specs' }, pending: ['test.command'] } });
  const s = await take(root);
  assert.deepEqual(s.gate.pending, ['test.command']);
});

// ── R8: solo lectura, comprobado ──────────────────────────────────────────────────────────────

test('R8 — el snapshot no crea, modifica ni borra nada', async () => {
  const root = await repo({
    state: { date: '2026-08-09T14:32:11Z', verdict: 'pass', fast: false, branch: 'x' },
    review: '## 2026-08-09T15:04:02Z · f6e5d4c3b2 · revisor · OK\n'
  });

  const listing = async () => (await readdir(root, { recursive: true })).sort();
  const before = await listing();
  await take(root);

  assert.deepEqual(await listing(), before, 'el advisor no puede tocar el repo que observa');
});

// ── R11: nunca revienta ───────────────────────────────────────────────────────────────────────

test('R11 — si el portón no se puede cargar, es un problema reportado, no una excepción', async () => {
  const root = await repo();
  const s = await take(root, { changed: async () => { throw new Error('falta .chalc/gate/lib/changed.mjs'); } });

  assert.ok(s.problems.length, 'el fallo tiene que llegar como problema');
  assert.match(s.problems.join(' '), /changed\.mjs/);
});

test('R11 — una carpeta que no es un repo equipado no lanza', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-vacio-'));
  await assert.doesNotReject(() => take(root));

  const s = await take(root);
  assert.equal(s.tasks.hasTasksFile, false);
});

test('R11 — un gate.state.json corrupto no lanza y no aprueba', async () => {
  const root = await repo();
  await writeFile(join(root, '.chalc', 'gate.state.json'), '{roto');

  const s = await take(root);
  assert.equal(s.gate.exists, false);
  assert.notEqual(s.gate.verdict, 'pass');
});
