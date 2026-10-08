// spec 014 · T19, T20 (R23, R24) — el revisor verifica la seguridad, y nadie se pisa.
//
// Con tres roles el riesgo no es que falte uno, es que sobren: dos informes que dicen lo mismo se
// leen en diagonal, y con ellos el hallazgo que sí importaba. Así que cada rol nombra lo que NO es
// suyo y de quién es. Y el revisor, que entra después de `seguridad`, no repite sus hallazgos: mira
// si las correcciones son de verdad.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENTS_DIR } from '../lib/roles.mjs';

const prompt = (role, code) => readFile(join(AGENTS_DIR, role, code === 'es' ? 'agent.md' : 'agent.en.md'), 'utf8');

test('R23: the reviewer reads the security section of the evidence and the security role entries', async () => {
  const es = await prompt('revisor', 'es');
  assert.match(es, /Supresiones de seguridad/);
  assert.match(es, /entradas? (?:del rol )?`seguridad`/);

  const en = await prompt('revisor', 'en');
  assert.match(en, /Security suppressions/);
  assert.match(en, /`seguridad` (?:role )?entr(?:y|ies)/);
});

test('R23: the reviewer checks that each security fix attacks the cause and has a test', async () => {
  const es = await prompt('revisor', 'es');
  assert.match(es, /causa/);
  assert.match(es, /test que demuestr/);
  assert.match(es, /`chalc-allow`[^.\n]*(?:justific|motivo)/);

  const en = await prompt('revisor', 'en');
  assert.match(en, /cause/);
  assert.match(en, /test that demonstrates/);
  assert.match(en, /`chalc-allow`[^.\n]*(?:justif|reason)/);
});

test('R23: the reviewer does not repeat the security findings', async () => {
  assert.match(await prompt('revisor', 'es'), /no repitas[^.\n]*seguridad|seguridad[^.\n]*no (?:los )?repitas/i);
  assert.match(await prompt('revisor', 'en'), /do not repeat[^.\n]*security|security[^.\n]*do not repeat/i);
});

// Cada rol dice qué es de los otros dos. Comprobarlo en los tres sentidos es lo que impide que dos
// informes se solapen sin que nadie lo note.
test('R24: each review role names what belongs to the other two', async () => {
  const others = { seguridad: ['revisor', 'endurecedor'], revisor: ['seguridad', 'endurecedor'], endurecedor: ['seguridad', 'revisor'] };
  const names = { es: { seguridad: /seguridad/, revisor: /revisor/, endurecedor: /endurecedor/ },
    en: { seguridad: /`?seguridad`?|security role/, revisor: /reviewer/, endurecedor: /hardener/ } };

  for (const [role, list] of Object.entries(others)) {
    for (const code of ['es', 'en']) {
      const notYours = (await prompt(role, code)).match(/(?:No es tuyo|Not yours)[^]*?\n## /)?.[0] || '';
      assert.ok(notYours, `${role}/${code}: sin sección «no es tuyo»`);
      for (const other of list) assert.match(notYours, names[code][other], `${role}/${code}: no menciona a ${other}`);
    }
  }
});
