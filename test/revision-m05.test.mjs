// M-05 (spec 016, R32) — un ÚNICO normalizador del idioma del spec para el contenido que chalc escribe en
// los proyectos: `blockText` y `handoffLang` discrepaban («Spanish» o «castellano» salían en inglés en los
// bloques del asistente). La regla .mdc de skills de Cursor sigue el idioma del spec, y la vista previa
// del plan de los targets (consola) va por t() desde un único helper.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentLang } from '../lib/contentlang.mjs';
import { blockText } from '../lib/targetkit.mjs';
import { handoffLang } from '../lib/commands/featurehandoff.mjs';
import { t } from '../lib/i18n.mjs';

const CATALOG = fileURLToPath(new URL('../catalog', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('R32: contentLang recognises Spanish in any common form, falls back to the UI language, else English', () => {
  for (const es of ['es', 'ES', 'español', 'Español (México)', 'Spanish', 'castellano', 'es-MX']) assert.equal(contentLang(es, 'en'), 'es', es);
  // «estonian» empieza por «es» y NO es español: un startsWith('es') ingenuo lo confundiría.
  for (const en of ['en', 'English', 'english', 'português', 'Deutsch', 'estonian']) assert.equal(contentLang(en, 'es'), 'en', en);
  assert.equal(contentLang('', 'es'), 'es');
  assert.equal(contentLang(undefined, 'en'), 'en');
});

test('R32: blockText and handoffLang agree with contentLang (Spanish and castellano are Spanish)', () => {
  for (const spec of ['Spanish', 'castellano', 'español', 'English', 'es', 'en']) {
    const code = contentLang(spec);
    assert.equal(handoffLang(spec), code, spec);
    assert.equal(blockText(spec).skillsActive, code === 'es' ? 'Skills activas' : 'Active skills', spec);
  }
});

test('R32: the Cursor skill rule is written in the spec language', async () => {
  const cursor = await import('../targets/cursor.mjs');
  const read = async (specLang) => {
    const projectPath = await mkdtemp(join(tmpdir(), 'chalc-m05-'));
    await cursor.apply({ projectPath, CATALOG, skills: ['clean-code'], mcps: [], methods: [], stacks: [], specLang, dryRun: false });
    return readFile(join(projectPath, '.cursor', 'rules', 'chalc-skill-clean-code.mdc'), 'utf8');
  };
  const en = await read('English');
  assert.match(en, /follow the full skill in `\.chalc\/skills\/clean-code\/SKILL\.md`/);
  assert.doesNotMatch(en, /Cuando esta tarea/);
  assert.match(await read('Spanish'), /Cuando esta tarea aplique, sigue la skill completa/);
});

test('R32: the targets plan preview uses the UI language for its words, from one helper', async () => {
  const methods = [{ id: 'sdd', mode: 'full' }];
  for (const name of ['claude', 'codex', 'copilot', 'gemini', 'cursor']) {
    const target = await import(`../targets/${name}.mjs`);
    const projectPath = await mkdtemp(join(tmpdir(), 'chalc-m05p-'));
    const { plan } = await target.apply({ projectPath, CATALOG, skills: [], mcps: [], methods, stacks: [], specLang: '', dryRun: true });
    assert.ok(plan.some((l) => l.startsWith(t('planMethod').padEnd(10))), name);
    assert.ok(!plan.some((l) => /método|scaffold \+ reglas|hook opcional|bloque chalc/.test(l)) || t('planMethod') === 'método', name);
  }
  for (const name of ['claude', 'codex', 'copilot', 'gemini', 'cursor']) {
    assert.doesNotMatch(readFileSync(join(ROOT, 'targets', `${name}.mjs`), 'utf8'), /`método {4}/, name);
  }
});

test('R32: the Claude plan carries its notes in the UI language', async () => {
  const claude = await import('../targets/claude.mjs');
  const projectPath = await mkdtemp(join(tmpdir(), 'chalc-m05c-'));
  const { plan } = await claude.apply({ projectPath, CATALOG, skills: [], mcps: [], methods: [{ id: 'sdd', mode: 'lite' }], stacks: [], specLang: '', dryRun: true });
  assert.ok(plan.includes(`${t('planMethod').padEnd(10)}sdd (lite)  ${t('planScaffoldRules')}`), plan.join('\n'));
  assert.ok(plan.includes(`doc       .chalc/gate-hook.md  ${t('planHookOptional')}`));
  assert.ok(plan.includes(`rules     CLAUDE.md  ${t('planChalcBlock')}`));
});
