// Spec 024 (coherencia), T10 — el comando `chalc-spec` en cada harness (R20, R24): guía al asistente desde la
// HU hasta la spec lista para que el USUARIO la apruebe, sin tests ni código antes y sin pedir tokens en el chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { SPEC_COMMAND, specCommandFile, writeSpecCommand } from '../lib/targetkit/speccommand.mjs';
import { commandPlanLines, writeCommands } from '../lib/targetkit/commands.mjs';
import { liveCommandFile } from '../lib/targetkit/livecommand.mjs';
import { teamsCommandFile } from '../lib/targetkit/teamscommand.mjs';
import { TARGET_LAYOUT } from '../lib/targetfiles.mjs';
import { MANAGED_MARK } from '../lib/targetkit/formats.mjs';

const FILES = {
  claude: '.claude/skills/chalc-spec/SKILL.md',
  codex: '.agents/skills/chalc-spec/SKILL.md',
  antigravity: '.agents/skills/chalc-spec/SKILL.md',
  cursor: '.cursor/commands/chalc-spec.md',
  copilot: '.github/prompts/chalc-spec.prompt.md'
};
const NEEDLES = ['chalc spec --azure', 'chalc spec --jira', 'chalc spec --doc', 'hu.md', 'specs/constitution.md', 'specs/_template', 'CLAUDE.md', 'AGENTS.md',
  'especificador', 'analista', 'node .chalc/next.mjs', 'fix_specs', 'approve_spec', 'node .chalc/gate.mjs --approve-spec', 'CHALC_PAT', '[NEEDS CLARIFICATION]'];

test('R20: el comando se llama chalc-spec y cada target lo recibe donde su harness lee comandos', () => {
  assert.equal(SPEC_COMMAND, 'chalc-spec');
  assert.deepEqual(Object.keys(FILES).sort(), Object.keys(TARGET_LAYOUT).sort());
  for (const [target, rel] of Object.entries(FILES)) assert.equal(specCommandFile(target), rel, target);
  assert.equal(specCommandFile('otro'), '');
});

for (const [target, rel] of Object.entries(FILES)) {
  for (const lang of ['es', 'en']) {
    test(`R20, R24 (${target}/${lang}): guía de la HU a la aprobación del usuario, sin pedir tokens`, async (t) => {
      const proj = await tempDir(t, 'chalc-024-cmd-');
      assert.equal(await writeSpecCommand(proj, target, lang), join(proj, ...rel.split('/')));
      const text = await readFile(join(proj, ...rel.split('/')), 'utf8');
      assert.ok(text.includes(MANAGED_MARK));
      for (const needle of NEEDLES) assert.ok(text.includes(needle), `falta ${needle}`);
      assert.match(text, lang === 'es' ? /Nunca pidas que peguen un token/ : /Never ask for a token to be pasted/);
      assert.match(text, lang === 'es' ? /PARA/ : /STOP/);
      assert.match(text, lang === 'es' ? /Solo el usuario aprueba/ : /Only the user approves/);
      assert.match(text, lang === 'es' ? /ni tests ni código/i : /no tests or code/i);
    });
  }
}

test('R20: el texto cambia con el idioma del spec y el formato es el nativo de cada harness', async (t) => {
  const es = await tempDir(t, 'chalc-024-cmd-');
  const en = await tempDir(t, 'chalc-024-cmd-');
  for (const target of Object.keys(FILES)) { await writeSpecCommand(es, target, 'es'); await writeSpecCommand(en, target, 'en'); }
  const read = (dir, target) => readFile(join(dir, ...FILES[target].split('/')), 'utf8');
  assert.notEqual(await read(es, 'cursor'), await read(en, 'cursor'));
  assert.match(await read(es, 'claude'), /^---\nname: chalc-spec\ndescription: .+\ndisable-model-invocation: true\n---\n/);
  assert.match(await read(es, 'codex'), /^---\nname: chalc-spec\ndescription: .+\n---\n/);
  assert.match(await read(es, 'copilot'), /^---\ndescription: .+\n---\n/);
  assert.doesNotMatch(await read(es, 'cursor'), /^---/);
});

test('R20: un archivo del usuario con ese nombre se respalda; el de chalc se reemplaza sin más', async (t) => {
  const proj = await tempDir(t, 'chalc-024-cmd-');
  const file = join(proj, ...FILES.cursor.split('/'));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'mi comando propio\n');
  await writeSpecCommand(proj, 'cursor', 'es');
  assert.ok((await readFile(file, 'utf8')).includes(MANAGED_MARK));
  assert.ok(existsSync(join(proj, '.chalc', 'backups')), 'lo del usuario quedó respaldado');
  await writeSpecCommand(proj, 'cursor', 'en');
  assert.match(await readFile(file, 'utf8'), /STOP/);
});

// Más chalc-teams (spec 034, R13): la entrada para varias specs.
test('R20: todo target planea y escribe sus comandos: chalc-live, chalc-spec y chalc-teams', async (t) => {
  for (const target of Object.keys(FILES)) {
    assert.deepEqual(commandPlanLines(target), [`command   ${liveCommandFile(target)}`, `command   ${specCommandFile(target)}`, `command   ${teamsCommandFile(target)}`], target);
    const proj = await tempDir(t, 'chalc-024-cmd-');
    await writeCommands(proj, target, 'es');
    assert.ok(existsSync(join(proj, ...liveCommandFile(target).split('/'))), `${target}: chalc-live`);
    assert.ok(existsSync(join(proj, ...specCommandFile(target).split('/'))), `${target}: chalc-spec`);
  }
});
