// T22 (R21) — el dashboard muestra en qué punto va cada lado, no solo cuánto lleva.
//
// El dashboard de la spec 006 ya decía "3/8 tareas" y cuál era la que tocaba. Lo que no decía es lo
// único que el usuario necesita para saber si algo está atascado: si ese lado está escribiendo
// código, esperando al portón, o parado con hallazgos del revisor sin arreglar. Dos lados con el
// mismo "3/8" pueden estar en situaciones opuestas.
//
// El advisor ya calcula exactamente eso, y el dashboard es de SOLO LECTURA igual que él — así que
// leer su consejo no le añade ningún privilegio: es la misma lectura de disco que ya hace.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sideAdvice } from '../lib/dashboard.mjs';
import { emitGate } from '../lib/gateemit.mjs';
import { emitNext } from '../lib/nextemit.mjs';

const SPEC = '008-advisor';

// Instante fijo del fuente: la evidencia de los tests con estado tiene que poder ser posterior.
const TOUCHED = Date.parse('2026-08-09T12:00:00Z');

// Un lado de workspace es un repo EQUIPADO: lleva su portón y su advisor dentro. Sin emitirlos, el
// dashboard no tendría a quién preguntar — que es justamente el caso `ask_human` de más abajo.
async function side({ tasks = '- [x] T1\n- [ ] T2 — en esto voy\n', state, review, config } = {}) {
  const dest = await mkdtemp(join(tmpdir(), 'chalc-dash-next-'));
  await mkdir(join(dest, 'specs', SPEC), { recursive: true });
  await emitGate(dest, { role: 'back', language: 'es' });
  await emitNext(dest);
  await writeFile(join(dest, '.chalc', 'gate.json'), JSON.stringify(config ?? { spec: { dir: 'specs' }, pending: [], language: 'es' }));
  await writeFile(join(dest, 'specs', SPEC, 'tasks.md'), tasks);
  // El fuente de la tarea y el registro de que fue esta tarea quien lo escribió (spec 013, R10).
  // Antes el lado no tenía ni fuentes ni registro: el alcance salía "no sé" y el advisor —con razón—
  // paraba a preguntar, que no es lo que estos tests miden. Se envejece a un instante fijo para que
  // la evidencia de los casos con `state` pueda ser posterior a él.
  await mkdir(join(dest, 'src'), { recursive: true });
  await writeFile(join(dest, 'src', 'a.ts'), 'export const x = 1;\n');
  await utimes(join(dest, 'src', 'a.ts'), TOUCHED / 1000, TOUCHED / 1000);
  await writeFile(join(dest, '.chalc', 'task.files'), 'src/a.ts\n');
  if (state) await writeFile(join(dest, '.chalc', 'gate.state.json'), JSON.stringify(state));
  if (review) await writeFile(join(dest, '.chalc', 'review.md'), review);
  return dest;
}

test('R21 — el dashboard obtiene el NEXT_ACTION de un lado', async () => {
  const advice = await sideAdvice(await side());

  assert.equal(typeof advice.action, 'string');
  assert.ok(advice.action.length);
});

test('R21 — distingue un lado bloqueado por configuración de uno trabajando', async () => {
  const working = await sideAdvice(await side());
  const blocked = await sideAdvice(await side({ config: { spec: { dir: 'specs' }, pending: ['test.command'], language: 'es' } }));

  assert.equal(blocked.action, 'blocked_config');
  assert.notEqual(working.action, 'blocked_config');
});

test('R21 — un lado con hallazgos del revisor se ve distinto de uno en marcha', async () => {
  const stuck = await sideAdvice(await side({
    tasks: '- [x] T1\n- [ ] T2\n',
    state: { date: '2026-08-09T14:00:00Z', verdict: 'pass', fast: false, branch: '' },
    review: '## 2026-08-09T15:00:00Z · a1b2c3d4e5 · revisor · FINDINGS: 2\n1. algo\n'
  }));

  assert.equal(stuck.action, 'fix_review');
});

test('R21 — un lado que no es repo equipado no rompe el dashboard', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'chalc-dash-vacio-'));

  await assert.doesNotReject(() => sideAdvice(empty));
  assert.equal((await sideAdvice(empty)).action, 'ask_human');
});

test('R21 — la consulta no modifica el lado: el dashboard sigue siendo de solo lectura', async () => {
  const dest = await side();
  const first = await sideAdvice(dest);
  const second = await sideAdvice(dest);

  assert.deepEqual(first, second);
});
