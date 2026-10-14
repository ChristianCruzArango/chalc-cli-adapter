// T6b (spec 021, R9) — el comando explícito `chalc-live` en cada harness.
//
// Una pregunta libre («¿cómo vamos?») no siempre se reconoce; un comando sí. Cada harness define los suyos en su
// formato (documentación oficial, 2026-10-13): Claude Code y Antigravity/Codex con una skill,
// Cursor con un .md en .cursor/commands y Copilot con un .prompt.md. Todos hacen lo mismo: levantar el tablero y
// responder solo con la URL.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LIVE_COMMAND, liveCommandFile, writeLiveCommand } from '../lib/targetkit/livecommand.mjs';
import { TARGET_LAYOUT } from '../lib/targetfiles.mjs';
import { MANAGED_MARK, yamlScalar } from '../lib/targetkit/formats.mjs';
import { lang as cliLang } from '../lib/i18n.mjs';

const project = () => mkdtemp(join(tmpdir(), 'chalc-live-cmd-'));
const FILES = {
  claude: '.claude/skills/chalc-live/SKILL.md',
  codex: '.agents/skills/chalc-live/SKILL.md',
  antigravity: '.agents/skills/chalc-live/SKILL.md',
  cursor: '.cursor/commands/chalc-live.md',
  copilot: '.github/prompts/chalc-live.prompt.md'
};

test('R9: the command is called chalc-live, and every target has its file where its harness reads commands', () => {
  assert.equal(LIVE_COMMAND, 'chalc-live');
  assert.deepEqual(Object.keys(FILES).sort(), Object.keys(TARGET_LAYOUT).sort());
  for (const [target, rel] of Object.entries(FILES)) assert.equal(liveCommandFile(target), rel, target);
  assert.equal(liveCommandFile('otro'), '');
});

for (const [target, rel] of Object.entries(FILES)) {
  test(`R9: ${target} gets a chalc-live command that runs the board and answers only with the URL`, async () => {
    for (const lang of ['es', 'en']) {
      const proj = await project();
      assert.equal(await writeLiveCommand(proj, target, lang), join(proj, rel));
      const text = await readFile(join(proj, rel), 'utf8');
      assert.ok(text.includes('node .chalc/live.mjs'), `${target}/${lang}`);
      assert.ok(text.includes(MANAGED_MARK), `${target}/${lang}: lleva la marca de chalc`);
      assert.match(text, lang === 'es' ? /URL/ : /URL/);
      assert.match(text, lang === 'es' ? /tablero/ : /board/, `${target}/${lang}`);
    }
  });
}

test('R9: each format is the native one: skill frontmatter and Copilot prompt frontmatter', async () => {
  const proj = await project();
  for (const target of Object.keys(FILES)) await writeLiveCommand(proj, target, 'es');
  const claude = await readFile(join(proj, FILES.claude), 'utf8');
  assert.match(claude, /^---\nname: chalc-live\ndescription: .+\ndisable-model-invocation: true\nallowed-tools: Bash\(node \.chalc\/live\.mjs\)\n---\n/);
  assert.match(await readFile(join(proj, FILES.codex), 'utf8'), /^---\nname: chalc-live\ndescription: .+\n---\n/);
  assert.match(await readFile(join(proj, FILES.copilot), 'utf8'), /^---\ndescription: .+\n---\n/);
  assert.doesNotMatch(await readFile(join(proj, FILES.cursor), 'utf8'), /^---/);
});

test('R9: a file of the user with that name is backed up, never overwritten blind; ours is just replaced', async () => {
  const proj = await project();
  await mkdir(join(proj, '.cursor', 'commands'), { recursive: true });
  await writeFile(join(proj, FILES.cursor), 'mío\n');
  await writeLiveCommand(proj, 'cursor', 'es');
  assert.ok((await readFile(join(proj, FILES.cursor), 'utf8')).includes('node .chalc/live.mjs'));
  assert.ok(existsSync(join(proj, '.chalc', 'backups')), 'the user file was backed up');
  await writeLiveCommand(proj, 'cursor', 'en');
  assert.match(await readFile(join(proj, FILES.cursor), 'utf8'), /board/);
});

test('R9: an unknown target writes nothing', async () => {
  assert.equal(await writeLiveCommand(await project(), 'otro', 'es'), null);
});

// Cada target lo escribe al equipar, y su plan lo anuncia.
test('R9: equipping each target leaves its chalc-live command, and the plan says so', async () => {
  const { pathToFileURL } = await import('node:url');
  for (const target of Object.keys(FILES)) {
    const proj = await project();
    const catalog = await project();
    const mod = await import(pathToFileURL(join(process.cwd(), 'targets', `${target}.mjs`)).href);
    const args = { projectPath: proj, CATALOG: catalog, skills: [], mcps: [], methods: [], stacks: [], architecture: null, specLang: 'es', roles: [] };
    const { plan } = await mod.apply({ ...args, dryRun: true });
    assert.ok(plan.some((l) => l.includes(FILES[target])), `${target}: plan`);
    await mod.apply({ ...args, dryRun: false });
    assert.ok(existsSync(join(proj, FILES[target])), `${target}: file`);
  }
});

// El texto del comando se fija entero: es lo que el agente lee y ejecuta.
const BODY = {
  es: ['Levanta el tablero en vivo del proyecto y entrega su URL.', '', '1. Corre `node .chalc/live.mjs` desde la raíz del proyecto.',
    '2. Responde SOLO con la URL que imprime: el tablero muestra en qué tarea va, qué corrió el portón, las notas de cada rol y lo que falta, y se actualiza solo.',
    '', 'No describas el estado tú: la página lo muestra.'],
  en: ['Start the project\'s live board and hand over its URL.', '', '1. Run `node .chalc/live.mjs` from the project root.',
    '2. Answer ONLY with the URL it prints: the board shows the task in progress, what the gate ran, each role\'s notes and what is missing, and it updates itself.',
    '', 'Do not describe the state yourself: the page shows it.']
};
const DESC = { es: 'Levanta el tablero en vivo del proyecto y responde con su URL.', en: 'Starts the project\'s live board and answers with its URL.' };
const MARK = `<!-- ${MANAGED_MARK}: lo genera chalc al equipar; los cambios aquí se reemplazan. -->`;

test('R9: the exact text of every format, in both languages', async () => {
  for (const lang of ['es', 'en']) {
    const proj = await project();
    for (const target of Object.keys(FILES)) await writeLiveCommand(proj, target, lang);
    const file = (t) => readFile(join(proj, FILES[t]), 'utf8');
    assert.equal(await file('cursor'), [MARK, '', ...BODY[lang], ''].join('\n'), lang);
    assert.equal(await file('codex'), ['---', 'name: chalc-live', `description: ${yamlScalar(DESC[lang])}`, '---', '', MARK, '', ...BODY[lang], ''].join('\n'), lang);
    assert.equal(await file('claude'), ['---', 'name: chalc-live', `description: ${yamlScalar(DESC[lang])}`, 'disable-model-invocation: true', 'allowed-tools: Bash(node .chalc/live.mjs)', '---', '', MARK, '', ...BODY[lang], ''].join('\n'), lang);
    assert.equal(await file('copilot'), ['---', `description: ${yamlScalar(DESC[lang])}`, '---', '', MARK, '', ...BODY[lang], ''].join('\n'), lang);
  }
});

test('R9: without a spec language it follows the CLI language', async () => {
  const proj = await project();
  await writeLiveCommand(proj, 'cursor');
  assert.ok((await readFile(join(proj, FILES.cursor), 'utf8')).includes(cliLang === 'es' ? 'Levanta el tablero' : 'Start the project'));
});
