// T21 (R20) — las reglas del método SDD que chalc proyecta al archivo del asistente.
//
// El hand-off se lee una vez, al empezar. Las reglas SDD viven en CLAUDE.md / AGENTS.md / GEMINI.md
// y se releen durante toda la feature — son el sitio donde el ciclo tiene que estar escrito para que
// siga vigente en la tarea número doce, cuando el hand-off ya se perdió en el scrollback.
//
// Los cuatro archivos (`lite`/`full` × es/en) van en paridad: un repo con el spec en inglés y modo
// full tiene que recibir exactamente las mismas reglas que uno en español y modo lite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SDD = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'catalog', 'methods', 'sdd');

const FILES = ['rules-lite.md', 'rules-lite.en.md', 'rules-full.md', 'rules-full.en.md'];

const read = (name) => readFile(join(SDD, name), 'utf8');

test('R20 — los cuatro archivos mandan consultar el advisor', async () => {
  for (const name of FILES) {
    assert.match(await read(name), /node \.chalc\/next\.mjs/, `${name}: no menciona el advisor`);
  }
});

test('R20 — los cuatro dicen que el advisor decide el orden, no el asistente', async () => {
  for (const name of FILES) {
    const text = await read(name);
    assert.match(text, /NEXT_ACTION/, `${name}: no nombra el campo que hay que obedecer`);
    assert.match(text, /\bdone\b/, `${name}: no dice hasta cuándo repetir`);
  }
});

test('R20 — ya nadie recita la lista de pasos como si el asistente tuviera que recordarla', async () => {
  // El "corre el portón, luego llama al revisor, luego marca" en prosa es justo lo que la spec 008
  // reemplaza. Si sobreviviera junto al advisor, el asistente tendría dos fuentes que se contradicen
  // en cuanto una de las dos se quede vieja.
  for (const name of FILES) {
    const text = await read(name);
    assert.ok(
      !/Llama al agente revisor|Call the `revisor` reviewer agent/.test(text),
      `${name}: sigue ordenando el paso a mano en vez de delegarlo al advisor`
    );
  }
});

test('R20 — paridad: los cuatro cubren los mismos puntos del ciclo', async () => {
  const marks = [/node \.chalc\/next\.mjs/, /NEXT_ACTION/, /COMMAND/, /\bdone\b/, /ask_human/];

  for (const name of FILES) {
    const text = await read(name);
    for (const mark of marks) assert.match(text, mark, `${name}: falta ${mark}`);
  }
});

test('R20 — el par lite/full de cada idioma dice EXACTAMENTE lo mismo del ciclo', async () => {
  // El número del paso sí difiere —lite tiene menos fases que full— y eso es correcto. Lo que no
  // puede diferir es el contenido: dos redacciones del mismo ciclo se desincronizan a la primera
  // corrección que alguien haga en una sola.
  const cycleOf = async (name) => (await read(name))
    .split(/\r?\n/)
    .filter((l) => /next\.mjs|NEXT_ACTION|COMMAND|ask_human/.test(l))
    .map((l) => l.replace(/^\s*\d+\.\s*/, '').trim());

  for (const [lite, full] of [['rules-lite.md', 'rules-full.md'], ['rules-lite.en.md', 'rules-full.en.md']]) {
    assert.deepEqual(await cycleOf(lite), await cycleOf(full), `${lite} y ${full} deben decir lo mismo del ciclo`);
  }
});
