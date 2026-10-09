// T36 (spec 016, R36) — `chalc init --lang <idioma>` genera el contenido del proyecto (docs/architecture.md,
// README de carpetas, principios, bloque del asistente) en ese idioma; sin `--lang`, en el de la
// interfaz como hasta ahora.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArchitectureDecision, renderArchitectureDecisionMarkdown, mandatoryPrinciples, MANDATORY_DESIGN_PRINCIPLES } from '../lib/init.mjs';
import { renderFolderReadme } from '../lib/init-folders.mjs';
import { applyArchitectureFolders } from '../lib/init-scaffold.mjs';
import { lang } from '../lib/i18n.mjs';

const decisionIn = (contentLang) => buildArchitectureDecision({ stack: 'angular', proposal: 'admin dashboard', ...(contentLang ? { contentLang } : {}) });

test('R36: docs/architecture.md follows the content language, whatever the UI language', () => {
  const en = renderArchitectureDecisionMarkdown(decisionIn('en'));
  assert.match(en, /^# Initial architecture decision/m);
  assert.match(en, /## Folder map \(what goes where\)/);
  assert.match(en, /- minimal implementation/);
  assert.doesNotMatch(en, /Decisión arquitectónica|Mapa de carpetas|implementación mínima/);
  const es = renderArchitectureDecisionMarkdown(decisionIn('es'));
  assert.match(es, /^# Decisión arquitectónica inicial/m);
  assert.match(es, /- implementación mínima/);
});

test('R36: without a content language everything stays in the UI language, exactly as before', () => {
  assert.equal(renderArchitectureDecisionMarkdown(decisionIn()), renderArchitectureDecisionMarkdown(decisionIn(lang)));
  assert.deepEqual(MANDATORY_DESIGN_PRINCIPLES, mandatoryPrinciples(lang));
  assert.equal(decisionIn().contentLang, lang);
});

test('R36: folder READMEs follow the content language', async () => {
  const label = 'Feature-first';
  assert.notEqual(renderFolderReadme('angular', label, 'src/app/core', 'en'), renderFolderReadme('angular', label, 'src/app/core', 'es'));
  assert.equal(renderFolderReadme('angular', label, 'src/app/core'), renderFolderReadme('angular', label, 'src/app/core', lang));
  const dir = await mkdtemp(join(tmpdir(), 'chalc-t36-'));
  const decision = decisionIn('en');
  const [first] = await applyArchitectureFolders(dir, decision);
  const written = await readFile(join(dir, first, 'README.md'), 'utf8');
  assert.match(written, /What goes here/);
  assert.doesNotMatch(written, /Qué va aquí|Buenas prácticas/);
});

test('R36: chalc init reads --lang and passes it to the decision and to the equipment', () => {
  const src = readFileSync(new URL('../lib/commands/init.mjs', import.meta.url), 'utf8');
  assert.match(src, /contentLang\(flags\.lang\)/);
  const equip = readFileSync(new URL('../lib/commands/equip.mjs', import.meta.url), 'utf8');
  assert.match(equip, /export async function equipCreatedProject\(proj, \{[^}]*specLang/);
});

// R39 (CLAUDE.md): `--lang` manda sobre CHALC_LANG para la INTERFAZ; con `--lang en` consola y contenido van en inglés.
test('R36/R39: with --lang the console summary follows it, above CHALC_LANG', { timeout: 30000 }, async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'chalc-t36c-'));
  const run = (contentFlag) => spawnSync(process.execPath, [fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url)), 'init', '--stack', 'angular', '--name', 'demo', '--dir', dir, '--dry-run', '--yes', '--lang', contentFlag], { encoding: 'utf8', env: { ...process.env, CHALC_LANG: 'es' }, input: '' });
  const en = run('en').stdout;
  assert.match(en, /minimal implementation/);
  assert.doesNotMatch(en, /implementación mínima/);
  assert.match(run('es').stdout, /implementación mínima/);
});

// Cada pieza, en LOS DOS idiomas: así el resultado no depende del idioma de la interfaz del que corre.
import { folderGuide } from '../lib/init-folders.mjs';
import { archText } from '../lib/init.mjs';
import { langCode } from '../lib/commands/catalogstore.mjs';

test('R36: every piece of docs/architecture.md uses the content language (both ways)', () => {
  for (const [code, depH] of [['es', 'Reglas de dependencia'], ['en', 'Dependency rules']]) {
    const decision = decisionIn(code);
    const doc = renderArchitectureDecisionMarkdown(decision);
    assert.match(doc, new RegExp(`## ${depH}`), code);
    assert.ok(doc.includes(archText(decision.architecture.label, code)), `${code}: etiqueta`);
    const folder = decision.architecture.folders.find((f) => folderGuide(decision.stack, f, 'es').goes !== folderGuide(decision.stack, f, 'en').goes);
    assert.ok(doc.includes(folderGuide(decision.stack, folder, code).goes), `${code}: mapa de carpetas`);
  }
});

test('R36: folder READMEs use the content language for headers and body (both ways, also on disk)', async () => {
  const decision = decisionIn('es');
  const folder = decision.architecture.folders.find((f) => folderGuide(decision.stack, f, 'es').goes !== folderGuide(decision.stack, f, 'en').goes);
  for (const [code, header] of [['es', 'Qué va aquí'], ['en', 'What goes here']]) {
    const readme = renderFolderReadme(decision.stack, 'Arq', folder, code);
    assert.match(readme, new RegExp(header), code);
    assert.ok(readme.includes(folderGuide(decision.stack, folder, code).goes), `${code}: cuerpo`);
  }
  const dir = await mkdtemp(join(tmpdir(), 'chalc-t36es-'));
  await applyArchitectureFolders(dir, decision);
  assert.match(await readFile(join(dir, folder, 'README.md'), 'utf8'), /Qué va aquí/);
});

test('R36: method files and principles follow the same normaliser', () => {
  assert.equal(langCode('English'), 'en');
  assert.equal(langCode('español'), 'es');
  assert.equal(langCode('português'), 'en');
  assert.equal(langCode(''), lang);
  assert.match(mandatoryPrinciples('es')[0], /implementación mínima/);
  assert.match(mandatoryPrinciples('en')[0], /minimal implementation/);
});

test('R36: archText picks the requested language, not the UI one', () => {
  assert.equal(archText({ es: 'Por capas', en: 'Layered' }, 'es'), 'Por capas');
  assert.equal(archText({ es: 'Por capas', en: 'Layered' }, 'en'), 'Layered');
  assert.equal(archText('plano', 'en'), 'plano');
});
