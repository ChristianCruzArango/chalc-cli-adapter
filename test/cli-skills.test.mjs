import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkillMetas, selectRelevant, buildSkillSections } from '../cli/skills/loader.mjs';

async function makeSkills(defs) {
  const skillsDir = await mkdtemp(join(tmpdir(), 'chalc-cli-skills-'));
  for (const [id, body] of Object.entries(defs)) {
    await mkdir(join(skillsDir, id), { recursive: true });
    await writeFile(join(skillsDir, id, 'SKILL.md'), body);
  }
  return skillsDir;
}

const fm = (name, desc, body = '') => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`;

test('loadSkillMetas lee frontmatter de las skills equipadas; [] si no equipado', async () => {
  const skillsDir = await makeSkills({ 'clean-code': fm('clean-code', 'Clean Code rules') });
  try {
    const project = { equipped: true, paths: { skillsDir }, detected: { skills: ['clean-code'] } };
    const metas = await loadSkillMetas(project);
    assert.equal(metas.length, 1);
    assert.equal(metas[0].name, 'clean-code');
    assert.match(metas[0].description, /Clean Code/);
    assert.deepEqual(await loadSkillMetas({ equipped: false }), []);
  } finally { await rm(skillsDir, { recursive: true, force: true }); }
});

test('selectRelevant: obligatorias siempre + relevantes por palabras de la tarea', () => {
  const metas = [
    { id: 'clean-code', name: 'clean-code', description: 'clean' },
    { id: 'angular-signals', name: 'angular-signals', description: 'Angular signals reactivity' },
    { id: 'flutter-async', name: 'flutter-async', description: 'Flutter async patterns' }
  ];
  const sel = selectRelevant(metas, { task: 'refactor the angular signals store', stacks: ['angular'] });
  const ids = sel.map((m) => m.id);
  assert.ok(ids.includes('clean-code'));        // obligatoria: siempre
  assert.ok(ids.includes('angular-signals'));   // relevante a la tarea
  assert.ok(!ids.includes('flutter-async'));    // irrelevante: fuera
});

test('selectRelevant no parte palabras españolas con acentos o ñ', () => {
  const metas = [
    { id: 'ui-design', name: 'diseño-ui', description: 'guías de diseño visual' },
    { id: 'flutter-async', name: 'flutter-async', description: 'Flutter async patterns' }
  ];
  const sel = selectRelevant(metas, { task: 'mejora el diseño de la pantalla según las guías', stacks: [] });
  const ids = sel.map((m) => m.id);
  assert.ok(ids.includes('ui-design'), '"diseño"/"guías" deben puntuar completas, no partidas en la ñ/í');
  assert.ok(!ids.includes('flutter-async'));
});

test('selectRelevant respeta el máximo de no-obligatorias', () => {
  const metas = Array.from({ length: 5 }, (_, i) => ({ id: `angular-${i}`, name: `angular-${i}`, description: 'angular thing' }));
  const sel = selectRelevant(metas, { task: 'angular angular', stacks: [], max: 2 });
  assert.equal(sel.length, 2);
});

test('buildSkillSections: índice requerido (compacto) + contenido completo opcional de relevantes', async () => {
  const skillsDir = await makeSkills({
    'clean-code': fm('clean-code', 'Clean Code rules', '# Clean Code\nCUERPO CLEAN'),
    'angular-signals': fm('angular-signals', 'Angular signals', '# Signals\nCUERPO SIGNALS'),
    'flutter-async': fm('flutter-async', 'Flutter async', '# Async\nCUERPO FLUTTER')
  });
  try {
    const project = { equipped: true, paths: { skillsDir }, detected: { skills: ['clean-code', 'angular-signals', 'flutter-async'] } };
    const metas = await loadSkillMetas(project);
    const sections = await buildSkillSections(metas, { task: 'add angular signals', stacks: ['angular'], language: 'es' });

    const index = sections.find((s) => s.key === 'skills');
    assert.ok(index.required, 'el índice de skills es requerido');
    assert.match(index.text, /equipped skills/);
    assert.match(index.text, /- angular-signals:/);          // lista todas, compacto
    assert.match(index.text, /- flutter-async:/);

    const keys = sections.map((s) => s.key);
    assert.ok(keys.includes('skill:clean-code'));            // obligatoria: contenido completo
    assert.ok(keys.includes('skill:angular-signals'));       // relevante: contenido completo
    assert.ok(!keys.includes('skill:flutter-async'));        // irrelevante: solo en el índice
    assert.match(sections.find((s) => s.key === 'skill:angular-signals').text, /CUERPO SIGNALS/);
    assert.equal(sections.find((s) => s.key === 'skill:angular-signals').required, false); // opcional: el budgeter decide
  } finally { await rm(skillsDir, { recursive: true, force: true }); }
});

test('buildSkillSections sin skills → []', async () => {
  assert.deepEqual(await buildSkillSections([], { task: 'x' }), []);
});

test('selección bilingüe: "formulario con señales" encuentra angular-forms y angular-signals', () => {
  const metas = [
    { id: 'angular-component', name: 'angular-component', description: 'components' },
    { id: 'angular-di', name: 'angular-di', description: 'dependency injection' },
    { id: 'angular-forms', name: 'angular-forms', description: 'reactive and template forms' },
    { id: 'angular-signals', name: 'angular-signals', description: 'signals state' },
    { id: 'clean-code', name: 'clean-code', description: 'clean code rules' }
  ];
  const picked = selectRelevant(metas, { task: 'crea un formulario de usuario con señales', stacks: ['angular'], max: 2 });
  const ids = picked.map((m) => m.id);
  // las específicas de la tarea ganan a las alfabéticas (component/di) y van ANTES que las obligatorias
  assert.deepEqual(ids.slice(0, 2), ['angular-forms', 'angular-signals']);
  assert.ok(ids.indexOf('angular-forms') < ids.indexOf('clean-code'));
});

test('relevantBlocks conserva el preámbulo + solo los bloques ## relevantes a la tarea', async () => {
  const { relevantBlocks } = await import('../cli/skills/loader.mjs');
  const guide = '### framework best practices\nGeneral rules here.\n## Components\nUse standalone.\n## Templates\nUse @if and @for, never *ngIf.\n## Services\nUse providedIn root.\n';
  const routed = relevantBlocks(guide, 'crea una plantilla con un formulario');
  assert.match(routed, /General rules here/);      // preámbulo siempre
  assert.match(routed, /## Templates/);            // "plantilla" → template ✔
  assert.doesNotMatch(routed, /## Services/);      // no relevante: fuera
});

test('relevantBlocks es SIN PÉRDIDA ante la duda: sin matches o sin bloques devuelve todo', async () => {
  const { relevantBlocks } = await import('../cli/skills/loader.mjs');
  const guide = 'intro\n## Components\nx\n## Services\ny\n';
  assert.equal(relevantBlocks(guide, 'zzz qqq www'), guide);        // nada puntúa → completo
  assert.equal(relevantBlocks('sin bloques aquí', 'plantilla'), 'sin bloques aquí');
});
