// T13 (spec 017, R12) — los tres roles saben responder a sus hallazgos anteriores, desde UN texto.
//
// El advisor exige una línea por hallazgo previo (R10); los roles tienen que saberlo, y en los tres
// —revisor, seguridad, endurecedor— la regla es la misma. Copiarla en seis archivos (tres roles × dos
// idiomas) es la receta para que uno se quede atrás: vive en `catalog/agents/_shared/` y cada prompt la
// recibe con el marcador `{{FOLLOWUPS}}`, como recibe `{{SKILLS}}`. El texto enseña al modelo las
// formas EXACTAS que el lector de la bitácora entiende; el test lo comprueba leyéndolas con ese lector.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS_DIR, loadRoles } from '../lib/roles.mjs';
import { roleText, writeRole } from '../lib/targetkit.mjs';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { tempDir } from './helpers/tmpdir.mjs';

const CATALOG = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'catalog');
const ROLES = ['revisor', 'seguridad', 'endurecedor'];
const LANGS = { es: 'español', en: 'english' };
const role = (id) => ({ id, cadence: 'task', summary: { es: id, en: id }, tools: ['Read'], writes: ['.chalc/review.md'] });

test('R12: every review role carries the follow-up marker once, in both languages', async () => {
  for (const id of ROLES) {
    for (const file of ['agent.md', 'agent.en.md']) {
      const prompt = await readFile(join(AGENTS_DIR, id, file), 'utf8');
      assert.equal(prompt.split('{{FOLLOWUPS}}').length - 1, 1, `${id}/${file}`);
    }
  }
});

test('R12: the marker is replaced by the shared text, in the language of the spec', async () => {
  for (const id of ROLES) {
    const es = (await roleText(CATALOG, role(id), { specLang: LANGS.es })).text;
    const en = (await roleText(CATALOG, role(id), { specLang: LANGS.en })).text;
    assert.ok(!es.includes('{{FOLLOWUPS}}') && !en.includes('{{FOLLOWUPS}}'), id);
    assert.match(es, /- Hallazgo <n>: corregido — <archivo:línea>/, id);
    assert.match(en, /- Finding <n>: fixed — <file:line>/, id);
  }
});

test('R12: the shared text joins the prompt without extra blank lines', async () => {
  // El checkout de Windows trae CRLF: se compara con los saltos normalizados.
  const lf = async (specLang) => (await roleText(CATALOG, role('revisor'), { specLang })).text.replace(/\r\n/g, '\n');
  assert.ok((await lf(LANGS.es)).includes('no lo que hay.\n\n## Qué devuelves'));
  assert.ok((await lf(LANGS.en)).includes('not what is there.\n\n## What you return'));
});

test('R12: the three roles receive the very same text', async () => {
  const shared = (text) => text.slice(text.indexOf('## Tus hallazgos de la pasada anterior'), text.indexOf('**Forma tu juicio'));
  const texts = await Promise.all(ROLES.map(async (id) => shared((await roleText(CATALOG, role(id), { specLang: LANGS.es })).text)));
  assert.ok(texts[0].length > 100);
  assert.ok(texts.every((t) => t === texts[0]));
});

// Lo que el prompt enseña tiene que ser lo que el advisor lee: si alguien cambia una de las dos
// partes, este test lo dice antes de que un modelo escriba líneas que nadie entiende.
test('R12: the forms the text teaches are exactly the forms the log reader understands', async () => {
  const fill = (line) => line.replace('<n>', '1').replace(/<archivo:línea>|<file:line>/, 'src/a.js:3').replace(/<motivo>|<reason>/, 'el código ya no existe');
  for (const [code, specLang] of Object.entries(LANGS)) {
    const { text } = await roleText(CATALOG, role('revisor'), { specLang });
    const taught = text.split('\n').filter((l) => /^- `- (Hallazgo|Finding) <n>:/.test(l)).map((l) => fill(l.match(/`([^`]+)`/)[1]));
    assert.equal(taught.length, 3, code);
    const statuses = taught.map((line) => allReviews(`## 2026-10-13T10:00:00Z · a1b2c3d4e5 · revisor · OK\n${line}`)[0].followups[1]?.status);
    assert.deepEqual(statuses, ['fixed', 'not-fixed', 'na'], code);
  }
});

test('R12: the role forms its judgement before reading the author of the change', async () => {
  assert.match((await roleText(CATALOG, role('revisor'), { specLang: LANGS.es })).text, /antes de leer al autor/i);
  assert.match((await roleText(CATALOG, role('revisor'), { specLang: LANGS.en })).text, /before reading the author/i);
});

test('R12: the shared folder is not a role', async () => {
  const ids = (await loadRoles()).map((r) => r.id);
  assert.deepEqual([...ids].sort(), [...ROLES].sort());
});

test('R12: a catalog without the shared text still renders the role, without the marker', async (tc) => {
  const base = await tempDir(tc, 'chalc-shared-');
  await mkdir(join(base, 'agents', 'revisor'), { recursive: true });
  await writeFile(join(base, 'agents', 'revisor', 'agent.md'), 'Revisor.\n\n{{SKILLS}}\n\n{{FOLLOWUPS}}\n', 'utf8');
  const { text } = await roleText(base, role('revisor'), { specLang: LANGS.es });
  assert.equal(text, 'Revisor.\n\n- (ninguna skill equipada)\n\n\n');
});

test('R12: the agent file Claude Code receives carries the shared text', async (tc) => {
  const dir = await tempDir(tc, 'chalc-shared-agent-');
  const dest = await writeRole(dir, CATALOG, role('seguridad'), { specLang: LANGS.es });
  const agent = await readFile(dest, 'utf8');
  assert.match(agent, /Hallazgo <n>: no corregido/);
  assert.ok(!agent.includes('{{'));
});
