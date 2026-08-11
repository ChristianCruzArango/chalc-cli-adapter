// T13 (spec 013, R9) — los roles de revisión reciben el alcance, no lo deducen.
//
// Este es el origen literal de la spec. El prompt del revisor pedía *"`git diff` de la tarea, solo
// lo que esta tarea tocó"* — y nadie se lo daba: no existía ninguna marca de dónde empezaba la
// tarea. Un prompt que pide algo que el sistema no sabe calcular deja el hueco al modelo, y el
// modelo lo rellena de las dos maneras malas: revisando deuda vieja, o no revisando porque "el diff
// es casi todo trabajo ajeno".
//
// Ahora la lista existe y está escrita en la evidencia (R7), así que el prompt puede señalar dónde
// leerla en vez de pedir un cálculo. Y una lista sin la prohibición de ampliarla no sirve: es la
// mitad que convierte un dato en un límite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = join(ROOT, 'catalog', 'agents');

const ROLES = ['revisor', 'endurecedor'];
const VARIANTS = ['agent.md', 'agent.en.md'];

const promptOf = (role, variant) => readFile(join(AGENTS, role, variant), 'utf8');

const eachPrompt = async (fn) => {
  for (const role of ROLES) {
    for (const variant of VARIANTS) await fn(await promptOf(role, variant), `${role}/${variant}`);
  }
};

// Dónde está la lista. Sin la ruta concreta, "revisa lo de esta tarea" vuelve a ser una instrucción
// que cada modelo interpreta a su manera.
test('every review role is told where the scope of the run is written', async () => {
  await eachPrompt((text, who) => {
    assert.match(text, /Alcance|\.chalc\/gate\.md/i, `${who} no dice dónde está el alcance`);
  });
});

// La prohibición. Una lista que se puede ampliar "ya que estoy" no acota nada, y ampliarla es
// exactamente lo que produce hallazgos de deuda vieja con nombre de hallazgo de hoy.
test('every review role is forbidden from widening the scope on its own', async () => {
  await eachPrompt((text, who) => {
    assert.match(text, /no (?:la |lo )?ampl|do not (?:widen|extend)|never (?:widen|extend)/i,
      `${who} no prohíbe ampliar el alcance`);
  });
});

// El endurecedor mira la feature entera y el revisor una tarea: son alcances distintos a propósito
// (uno cierra la feature, el otro cada tarea). Lo que ninguno de los dos puede hacer es revisar el
// proyecto — con la deuda de años dentro, que no es de nadie y entierra lo que sí lo es.
test('no review role is pointed at the whole project', async () => {
  await eachPrompt((text, who) => {
    assert.doesNotMatch(text, /revisa (?:todo )?el (?:proyecto|repositorio) entero|review the whole (?:project|repo)/i,
      `${who} apunta al proyecto entero`);
  });
});

// El texto viejo pedía un cálculo imposible. Que no vuelva por copiar y pegar de una versión
// anterior: `git diff` a secas no acota una tarea, y el revisor no tiene por qué saber de git.
test('the reviewer no longer asks for a diff nobody can give it', async () => {
  for (const variant of VARIANTS) {
    const text = await promptOf('revisor', variant);
    assert.doesNotMatch(text, /`git diff` de la tarea|`git diff` of the task/i,
      `revisor/${variant} sigue pidiendo el diff de la tarea`);
  }
});
