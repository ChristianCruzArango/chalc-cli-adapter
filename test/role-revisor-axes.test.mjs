// T5 (spec 019, R3, R5) — el revisor juzga en dos ejes separados, con un vocabulario fijo de olores.
//
// Adaptado del skill `code-review` de mattpocock/skills (MIT): **Spec** (¿hace lo que la spec pidió?) y
// **Estándares** (¿respeta las reglas del repo?). Un cambio puede pasar un eje y suspender el otro, y
// mezclarlos deja que uno tape al otro. La lista de olores es la de Fowler (*Refactoring*, cap. 3), siempre
// como juicio, nunca como violación dura. Lo que el prompt enseña tiene que ser lo que el advisor lee: el
// test lee con el lector de la bitácora las líneas de requisito que el prompt enseña.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENTS_DIR } from '../lib/roles.mjs';
import { allReviews } from '../catalog/next/lib/review.mjs';

const prompt = (file) => readFile(join(AGENTS_DIR, 'revisor', file), 'utf8');
const SMELLS = ['Mysterious Name', 'Duplicated Code', 'Feature Envy', 'Data Clumps', 'Primitive Obsession', 'Repeated Switches',
  'Shotgun Surgery', 'Divergent Change', 'Speculative Generality', 'Message Chains', 'Middle Man', 'Refused Bequest'];

const LANGS = {
  'agent.md': { spec: /^### Eje Spec/m, standards: /^### Eje Estándares/m, tags: ['[spec]', '[estándares]'], rerank: /no los mezcles ni los reordenes/i, limit: /400 palabras/, noise: /Si dudas de si algo es un problema, no lo es/, reach: /llega al usuario/i },
  'agent.en.md': { spec: /^### Spec axis/m, standards: /^### Standards axis/m, tags: ['[spec]', '[standards]'], rerank: /do not merge or rerank them/i, limit: /400 words/, noise: /If you are unsure whether something is a problem, it isn't/, reach: /reaches the user/i }
};

test('R3: the reviewer judges in two separate axes, tagged, without reranking across them', async () => {
  for (const [file, l] of Object.entries(LANGS)) {
    const text = await prompt(file);
    assert.match(text, l.spec, file);
    assert.match(text, l.standards, file);
    for (const tag of l.tags) assert.ok(text.includes(tag), `${file}: ${tag}`);
    assert.match(text, l.rerank, file);
  }
});

test('R4: the requirement lines the prompt teaches are exactly the ones the log reader understands', async () => {
  for (const file of Object.keys(LANGS)) {
    const taught = (await prompt(file)).split('\n')
      .filter((line) => /^- `- R<n>:/.test(line))
      .map((line) => line.match(/`([^`]+)`/)[1].replace('<n>', '1').replace(/<archivo:línea>|<file:line>/, 'src/a.ts:3').replace(/<motivo>|<reason>/, 'la tarea no toca esto'));
    assert.equal(taught.length, 3, file);
    const statuses = taught.map((line) => allReviews(`## 2026-10-13T10:00:00Z · a1b2c3d4e5 · revisor · OK\n${line}`)[0].requirements.R1?.status);
    assert.deepEqual(statuses, ['complies', 'violates', 'na'], file);
  }
});

test('R4: the spec axis asks whether each requirement actually reaches the user', async () => {
  for (const [file, l] of Object.entries(LANGS)) assert.match(await prompt(file), l.reach, file);
});

test('R5: the standards axis carries the twelve Fowler smells, as judgement calls, credited', async () => {
  for (const file of Object.keys(LANGS)) {
    const text = await prompt(file);
    for (const smell of SMELLS) assert.ok(text.includes(`**${smell}**`), `${file}: ${smell}`);
    assert.match(text, /Fowler/, file);
    assert.match(text, /mattpocock\/skills/, file);
  }
});

test('R5: the anti-noise rule and a length cap stay', async () => {
  for (const [file, l] of Object.entries(LANGS)) {
    const text = await prompt(file);
    assert.match(text, l.noise, file);
    assert.match(text, l.limit, file);
  }
});

test('R5: what the reviewer already had is still there', async () => {
  for (const file of Object.keys(LANGS)) {
    const text = await prompt(file);
    for (const kept of ['{{SKILLS}}', '{{FOLLOWUPS}}', 'chalc-allow', '`endurecedor`', '`seguridad`']) assert.ok(text.includes(kept), `${file}: ${kept}`);
  }
});
