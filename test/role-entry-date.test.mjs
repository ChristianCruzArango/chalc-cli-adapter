// T15 (spec 017, R15) — cada rol sabe CÓMO obtener la fecha UTC de su entrada.
//
// Encontrado en el E2E: el prompt decía «la fecha es UTC», pero no cómo obtenerla, y el rol real escribió
// la hora local con una `Z` (`13:20:00Z` siendo las 18:17 UTC). El advisor descarta una entrada anterior
// al portón, así que volvía a pedir el rol una y otra vez. El prompt da ahora el comando exacto, y este
// test lo ejecuta y comprueba que su salida es una fecha que el lector de la bitácora acepta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { AGENTS_DIR } from '../lib/roles.mjs';
import { allReviews } from '../catalog/next/lib/review.mjs';

const ROLES = ['revisor', 'seguridad', 'endurecedor'];
const DATE_COMMAND = `node -e "console.log(new Date().toISOString().slice(0, 19) + 'Z')"`;

test('R15: every review role is given the exact command for the UTC date, in both languages', async () => {
  for (const role of ROLES) {
    for (const file of ['agent.md', 'agent.en.md']) {
      const prompt = await readFile(join(AGENTS_DIR, role, file), 'utf8');
      assert.ok(prompt.includes(`\`${DATE_COMMAND}\``), `${role}/${file}`);
    }
  }
});

test('R15: the command prints the current UTC time in the format the log reader accepts', () => {
  const before = Date.now();
  const printed = execSync(DATE_COMMAND, { encoding: 'utf8' }).trim();
  const [entry] = allReviews(`## ${printed} · a1b2c3d4e5 · revisor · OK\n`);
  assert.ok(entry, `the reader rejected «${printed}»`);
  assert.ok(Math.abs(entry.date - before) < 5000, `«${printed}» is not now in UTC`);
});

test('R15: the prompts warn that local time with a Z is not UTC', async () => {
  for (const role of ROLES) {
    assert.match(await readFile(join(AGENTS_DIR, role, 'agent.md'), 'utf8'), /no escribas la hora local/i, role);
    assert.match(await readFile(join(AGENTS_DIR, role, 'agent.en.md'), 'utf8'), /do not write local time/i, role);
  }
});
