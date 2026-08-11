// T14 (spec 013, R10) — el harness deja escrito lo que escribió.
//
// El harness ya sabía qué archivos tocó cada turno: lo usaba para pasarle al reviewer local el diff
// acotado, y ahí se acababa — el dato moría con el turno. Persistirlo en `.chalc/task.files` es lo
// que hace que el portón y los roles de la tarea puedan usar la misma verdad.
//
// Y en un flujo donde se commitea al final, esto no es un atajo: es EL mecanismo. La línea base es
// un commit, así que con el trabajo sin commitear el diff no separa una tarea de la anterior. El
// registro sí.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTask } from '../cli/session.mjs';
import { readTouched, TOUCHED_REL } from '../catalog/gate/lib/touched.mjs';

async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-cli-touched-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf8');
  return dir;
}

// Un modelo de mentira que responde con los pasos que se le den, en orden. El protocolo del harness
// es JSON por turno; aquí solo hace falta que las acciones lleguen a las tools.
function scripted(...replies) {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)];
}

const writes = (path, content) => JSON.stringify({
  thought: 'escribo el archivo', action: { tool: 'write', args: { path, content } }
});

const finish = JSON.stringify({ thought: 'listo', done: { summary: 'hecho' } });

const CFG = { provider: 'test', model: 'test' };

test('what the harness writes in a turn ends up in the task record', async () => {
  const dir = await project();

  await runTask({
    projectPath: dir, cfg: CFG, task: 'crea el servicio de pago', approve: async () => true,
    chatImpl: scripted(writes('src/pago.service.ts', 'export const pagar = () => 1;\n'), finish)
  });

  assert.deepEqual((await readTouched(dir)).files, ['src/pago.service.ts']);
});

// Dos turnos de la misma tarea suman. Si el segundo pisara al primero, el alcance dejaría fuera
// justo los archivos del principio — los que llevan más tiempo sin que nadie los mire.
test('a second turn adds to the record instead of replacing it', async () => {
  const dir = await project();
  const cfg = { projectPath: dir, cfg: CFG, approve: async () => true };

  await runTask({ ...cfg, task: 'primero', chatImpl: scripted(writes('src/uno.ts', 'export const a = 1;\n'), finish) });
  await runTask({ ...cfg, task: 'segundo', chatImpl: scripted(writes('src/dos.ts', 'export const b = 2;\n'), finish) });

  assert.deepEqual((await readTouched(dir)).files, ['src/dos.ts', 'src/uno.ts']);
});

// Un turno que no escribe nada no deja registro: crear un archivo vacío ensuciaría el `.chalc/` del
// usuario y, peor, un registro vacío se lee igual que "esta tarea no tocó nada".
test('a turn that writes nothing leaves no record behind', async () => {
  const dir = await project();

  await runTask({ projectPath: dir, cfg: CFG, task: 'solo mira', approve: async () => true, chatImpl: scripted(finish) });

  assert.equal(existsSync(join(dir, TOUCHED_REL)), false);
});
