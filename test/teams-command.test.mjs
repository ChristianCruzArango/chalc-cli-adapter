// Spec 034 (roles y lanzadores), T7 — el comando `chalc-teams` (R13): la entrada para varias specs, en cada
// asistente; y `chalc-spec` sigue por el MISMO motor tras la aprobación: una spec es un equipo de una.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { TEAMS_COMMAND, teamsCommandFile, writeTeamsCommand } from '../lib/targetkit/teamscommand.mjs';
import { writeSpecCommand } from '../lib/targetkit/speccommand.mjs';
import { commandPlanLines, writeCommands } from '../lib/targetkit/commands.mjs';

const TARGETS = ['claude', 'codex', 'antigravity', 'cursor', 'copilot'];
const ENGINE = ['node .chalc/team.mjs open --feature', 'node .chalc/team.mjs waves --feature', 'node .chalc/team.mjs dispatch --spec'];

test('R13: el comando se llama chalc-teams y cada asistente lo recibe en su sitio', () => {
  assert.equal(TEAMS_COMMAND, 'chalc-teams');
  assert.equal(teamsCommandFile('claude'), '.claude/skills/chalc-teams/SKILL.md');
  assert.equal(teamsCommandFile('cursor'), '.cursor/commands/chalc-teams.md');
  assert.equal(teamsCommandFile('copilot'), '.github/prompts/chalc-teams.prompt.md');
  assert.equal(teamsCommandFile('nadie'), '');
  for (const target of TARGETS) assert.ok(commandPlanLines(target).includes(`command   ${teamsCommandFile(target)}`), target);
});

for (const [lang, words] of [['es', ['orquestador', 'Nunca']], ['en', ['orchestrator', 'Never']]]) {
  test(`R13 (${lang}): el comando lleva el carril entero, con cada comando del equipo`, async (t) => {
    const dir = await tempDir(t, 'chalc-034-teams-');
    const text = await readFile(await writeTeamsCommand(dir, 'claude', lang), 'utf8');
    for (const piece of [...words, ...ENGINE, 'chalc-spec', 'node .chalc/gate.mjs --approve-spec', '--role lider', 'node .chalc/team.mjs status', 'node .chalc/team.mjs report --feature',
      'node .chalc/gate.mjs --approve-feature', '`Toca:`', 'disable-model-invocation: true']) {
      assert.ok(text.includes(piece), `falta «${piece}»`);
    }
  });

  test(`R13 (${lang}): chalc-spec sigue por el mismo motor tras la aprobación, con una sola spec`, async (t) => {
    const dir = await tempDir(t, 'chalc-034-teams-');
    const text = await readFile(await writeSpecCommand(dir, 'claude', lang), 'utf8');
    for (const piece of [...ENGINE, 'chalc-teams']) assert.ok(text.includes(piece), `falta «${piece}»`);
  });
}

test('R13: al escribir los comandos de un asistente, chalc-teams va con los demás', async (t) => {
  for (const target of TARGETS) {
    const dir = await tempDir(t, 'chalc-034-teams-');
    const written = await writeCommands(dir, target, 'es');
    assert.ok(written.includes(join(dir, ...teamsCommandFile(target).split('/'))), target);
  }
});

test('R13: un asistente desconocido no recibe nada', async (t) => {
  assert.equal(await writeTeamsCommand(await tempDir(t, 'chalc-034-teams-'), 'nadie', 'es'), null);
});
