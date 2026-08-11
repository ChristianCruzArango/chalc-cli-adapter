// Las skills que chalc copia no pueden contradecir la constitución del método.
//
// Esto salió de un caso real: en repos equipados aparecían interfaces declaradas DENTRO de servicios
// y componentes, que el Artículo 4 prohíbe. El portón las detectaba correctamente — se comprobó con
// código real de NestJS y Angular — así que no era un fallo de detección.
//
// Era que el asistente estaba OBEDECIENDO. `minimal-implementation` dice "no crees interfaces, DTOs,
// mappers…" y resuelve el conflicto remitiendo a `docs/architecture.md`… que en un repo equipado con
// `spec-ia` **no existe**: solo lo crea `chalc init` con arquitectura. Sin ese archivo, la excepción
// no aplicaba y la prohibición sí. La constitución, que sí está siempre y sí lo exige, no se
// mencionaba en ninguna skill.
//
// Dos fuentes de autoridad y una que no sabe de la otra: el mismo patrón que la spec 011 quitó de la
// tabla de herramientas, aquí entre la constitución y las skills.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'catalog', 'skills');

const skill = (id) => readFile(join(SKILLS, id, 'SKILL.md'), 'utf8');

async function allSkills() {
  const found = [];
  for (const entry of await readdir(SKILLS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { found.push({ id: entry.name, text: await readFile(join(SKILLS, entry.name, 'SKILL.md'), 'utf8') }); }
    catch { /* sin SKILL.md */ }
  }
  return found;
}

// ── Artículo 4: una cosa por archivo ──────────────────────────────────────────────────────────

test('la skill que restringe crear archivos cita la constitución, no solo la arquitectura', async () => {
  // `docs/architecture.md` es opcional; `specs/constitution.md` lo pone SIEMPRE el método SDD. Una
  // regla que solo remite al archivo opcional se desactiva sola en el caso más común.
  const text = await skill('minimal-implementation');

  assert.match(text, /specs\/constitution\.md/, 'sin citar la constitución, la excepción depende de un archivo que puede no existir');
});

test('la regla de "una cosa por archivo" NO queda condicionada a que exista una arquitectura', async () => {
  const text = await skill('minimal-implementation');

  assert.ok(
    !/when the architecture requires it/i.test(text),
    'ese condicional es justo el que hace que la regla no aplique en un repo sin docs/architecture.md'
  );
  assert.match(text, /even (?:if|when) (?:there is no|no) .*architecture/i,
    'tiene que decir explícitamente que aplica aunque no haya arquitectura declarada');
});

test('ninguna skill prohíbe crear tipos sin dar la salida del Artículo 4', async () => {
  // "Do not create … interfaces … DTOs …" leído solo, produce exactamente lo que pasó: el tipo
  // acaba dentro del servicio. Donde aparezca esa prohibición tiene que estar su excepción al lado.
  for (const { id, text } of await allSkills()) {
    const prohibe = /Do not create[^.]*\b(?:interfaces|DTOs)\b/i.test(text);
    if (!prohibe) continue;

    assert.match(text, /own file/i, `${id}: prohíbe crear tipos y no dice dónde van los que sí existen`);
    assert.match(text, /constitution/i, `${id}: prohíbe crear tipos sin remitir a la autoridad que lo exige`);
  }
});

// La constitución que importa es la que chalc REPARTE, no la copia local de este repo — que además
// está en `.gitignore` y no existe en CI: leerla de ahí hacía que el test pasara en la máquina de
// quien lo escribió y fallara en cualquier otra. Las cuatro que se emiten (lite/full × es/en) tienen
// que exigir lo mismo, o las skills corregidas apuntarían a una regla que en algún modo no está.
test('las CUATRO constituciones que chalc emite exigen el Artículo 4', async () => {
  const scaffolds = {
    'scaffold-lite': [/Una cosa por archivo/i, /Nunca declarados dentro de servicios/i],
    'scaffold-full': [/Una cosa por archivo/i, /Nunca declarados dentro de servicios/i],
    'scaffold-lite-en': [/One thing per file/i, /Never declared inside services/i],
    'scaffold-full-en': [/One thing per file/i, /Never declared inside services/i]
  };

  for (const [scaffold, patterns] of Object.entries(scaffolds)) {
    const file = join(ROOT, 'catalog', 'methods', 'sdd', scaffold, 'specs', 'constitution.md');
    const text = await readFile(file, 'utf8');
    for (const pattern of patterns) assert.match(text, pattern, `${scaffold}: falta ${pattern}`);
  }
});

// Y ninguna otra parte de la suite puede depender de archivos que el repo no versiona: pasaría en
// local y fallaría en CI, que es la forma más cara de descubrir un test mal escrito.
test('ningún test lee la carpeta specs/ de ESTE repo, que está en .gitignore', async () => {
  const { readdir } = await import('node:fs/promises');
  const dir = join(ROOT, 'test');

  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.test.mjs'))) {
    const text = await readFile(join(dir, name), 'utf8');
    assert.ok(
      !/join\(\s*ROOT\s*,\s*'specs'/.test(text),
      `${name} lee specs/ del repo: está en .gitignore y no existe en CI`
    );
  }
});

// ── La duplicación es un hallazgo, no una opción ──────────────────────────────────────────────

test('clean-code no condiciona quitar la duplicación a que aparezca la abstracción perfecta', async () => {
  // "Remove duplication ONLY when the shared abstraction has a stable meaning" frena en vez de
  // empujar: leída por un modelo, autoriza a dejarla. Y la duplicación fue el otro síntoma real.
  const text = await skill('clean-code');

  assert.ok(
    !/Remove duplication only when/i.test(text),
    'ese "only when" convierte quitar duplicación en opcional'
  );
});

test('clean-code dice qué hacer cuando la abstracción correcta todavía no está clara', async () => {
  // El matiz original era bueno: no inventes una abstracción mala para no repetirte. Pero tiene que
  // acabar en una acción, no en permiso para dejarlo.
  const text = await skill('clean-code');

  assert.match(text, /duplicat/i, 'la duplicación tiene que seguir siendo un tema de la skill');
  assert.match(text, /report|flag|name it|leave a note|señal/i,
    'si no se puede quitar todavía, la salida es reportarlo — no callarlo');
});
