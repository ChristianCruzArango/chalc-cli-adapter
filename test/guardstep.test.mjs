// T8 (spec 023, R4, R5, R8, R9, R13, R14, R15) — el paso de la guarda que comparten `init` y `apply`.
//
// `guardWanted` decide qué se pide: el flag manda (`--guard` → true, `--no-guard` → false); sin flag, solo
// `init` interactivo con Claude Code pregunta, con «sí» por defecto; en cualquier otro caso, `null` = no tocar.
// `runGuardStep` lo cumple y devuelve las líneas a mostrar, ya en el idioma del usuario: no imprime. En
// dry-run solo describe; con otro asistente avisa y no escribe; lo que no entiende lo avisa sin lanzar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { guardWanted, runGuardStep } from '../lib/commands/guardstep.mjs';
import { t as tr } from '../lib/i18n.mjs';

const local = (dir) => join(dir, '.claude', 'settings.local.json');

// Prompter falso: responde `answer` y anota cada pregunta con su valor por defecto.
function fakePrompter(answer) {
  const asked = [];
  return { asked, yesno: async (question, def) => { asked.push([question, def]); return answer; } };
}

// Nada de la guarda en el proyecto: ni ajustes locales ni `.gitignore`.
const untouched = (dir) => !existsSync(join(dir, '.claude')) && !existsSync(join(dir, '.gitignore'));

// ── guardWanted ───────────────────────────────────────────────────────────────────────────────────

test('R14, R15: the flag decides, without asking', async () => {
  for (const flag of [true, false]) {
    for (const targetName of ['claude', 'codex']) {
      const prompter = fakePrompter(!flag);
      assert.equal(await guardWanted({ flag, prompter, targetName }), flag, `${flag} ${targetName}`);
      assert.deepEqual(prompter.asked, []);
    }
  }
});

test('R13: interactive init with Claude Code asks, with yes by default, and takes the answer', async () => {
  for (const answer of [true, false]) {
    const prompter = fakePrompter(answer);
    assert.equal(await guardWanted({ flag: undefined, prompter, targetName: 'claude' }), answer);
    assert.deepEqual(prompter.asked, [[tr('guardQ'), true]]);
  }
});

test('R5: without the flag, and with no one to ask or another assistant, nothing is touched', async () => {
  assert.equal(await guardWanted({ flag: undefined, prompter: null, targetName: 'claude' }), null);
  assert.equal(await guardWanted({ flag: undefined, targetName: 'claude' }), null);
  const prompter = fakePrompter(true);
  assert.equal(await guardWanted({ flag: undefined, prompter, targetName: 'codex' }), null);
  assert.deepEqual(prompter.asked, []);
});

// ── runGuardStep ──────────────────────────────────────────────────────────────────────────────────

test('R5: when nothing was asked for, nothing is written nor said', async (t) => {
  const dir = await tempDir(t, 'chalc-guardstep-');
  assert.deepEqual(await runGuardStep(dir, { want: null, targetName: 'claude', dryRun: false }), []);
  assert.ok(untouched(dir));
});

test('R9: another assistant gets the warning and no settings', async (t) => {
  const dir = await tempDir(t, 'chalc-guardstep-');
  for (const dryRun of [false, true]) {
    assert.deepEqual(await runGuardStep(dir, { want: true, targetName: 'codex', dryRun }), [tr('guardOnlyClaude', 'codex')]);
  }
  assert.ok(untouched(dir));
});

test('R8: the dry-run only describes the change', async (t) => {
  const dir = await tempDir(t, 'chalc-guardstep-');
  assert.deepEqual(await runGuardStep(dir, { want: true, targetName: 'claude', dryRun: true }), [tr('guardDryAdd')]);
  assert.ok(untouched(dir));
  await runGuardStep(dir, { want: true, targetName: 'claude', dryRun: false });
  const before = await readFile(local(dir), 'utf8');
  assert.deepEqual(await runGuardStep(dir, { want: false, targetName: 'claude', dryRun: true }), [tr('guardDryRemove')]);
  assert.equal(await readFile(local(dir), 'utf8'), before);
});

test('R1, R14: enabling says it was added, and the second time that nothing changed', async (t) => {
  const dir = await tempDir(t, 'chalc-guardstep-');
  const step = () => runGuardStep(dir, { want: true, targetName: 'claude', dryRun: false });
  assert.deepEqual(await step(), [tr('guardAdded')]);
  assert.ok(existsSync(local(dir)));
  assert.deepEqual(await step(), [tr('guardUnchanged')]);
});

// Quitarla no depende del asistente: solo retira lo que chalc puso, y quien cambió de asistente la quiere fuera.
test('R15: disabling says it was removed, and the second time that there was nothing to remove', async (t) => {
  for (const targetName of ['claude', 'codex']) {
    const dir = await tempDir(t, 'chalc-guardstep-');
    await runGuardStep(dir, { want: true, targetName: 'claude', dryRun: false });
    const step = () => runGuardStep(dir, { want: false, targetName, dryRun: false });
    assert.deepEqual(await step(), [tr('guardRemoved')], targetName);
    assert.equal(existsSync(local(dir)), false, targetName);
    assert.deepEqual(await step(), [tr('guardAbsent')], targetName);
  }
});

test('R4: a settings file chalc cannot read gets a warning, not an error, and is left as it was', async (t) => {
  const dir = await tempDir(t, 'chalc-guardstep-');
  await mkdir(join(dir, '.claude'));
  await writeFile(local(dir), '{ roto');
  for (const want of [true, false]) {
    assert.deepEqual(await runGuardStep(dir, { want, targetName: 'claude', dryRun: false }), [tr('guardInvalid')]);
  }
  assert.equal(await readFile(local(dir), 'utf8'), '{ roto');
});
