// Spec 024 (coherencia), T8 y T8b — los dos roles de cadencia `spec` (R13, R26): el `especificador` redacta
// spec, plan y tareas desde la HU; el `analista` los revisa contra ella y no modifica nada. Quien escribe no revisa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { AGENTS_DIR, loadRoles, toolsFor } from '../lib/roles.mjs';
import { roleLines, roleText, writeRole } from '../lib/targetkit/roles.mjs';
import { detectGateConfig } from '../lib/gatedetect.mjs';

const CATALOG = join(AGENTS_DIR, '..');
const byId = async (id) => (await loadRoles()).find((r) => r.id === id);

test('R13, R26: el catálogo trae especificador y analista, en ese orden y antes que los roles de tarea', async () => {
  const roles = await loadRoles();
  assert.deepEqual(roles.map((r) => r.id).slice(0, 2), ['especificador', 'analista']);
  assert.deepEqual(roles.filter((r) => r.cadence === 'spec').map((r) => r.id), ['especificador', 'analista']);
  for (const role of roles.filter((r) => r.cadence === 'spec')) {
    assert.ok(role.summary.es.length > 40 && role.summary.en.length > 40, role.id);
  }
});

test('R13: el analista solo escribe su bitácora y no tiene herramientas de edición', async () => {
  const analista = await byId('analista');
  assert.equal(analista.kind ?? 'reviewer', 'reviewer');
  assert.deepEqual(analista.writes, ['.chalc/review.md']);
  assert.deepEqual(toolsFor(analista), ['Read', 'Grep', 'Glob', 'Bash', 'Write']);
});

test('R26: el especificador es autor: puede editar, y solo dentro de specs/', async () => {
  const especificador = await byId('especificador');
  assert.equal(especificador.kind, 'author');
  assert.deepEqual(especificador.writes, ['specs/**']);
  assert.ok(toolsFor(especificador).includes('Edit'));
});

test('R26: solo un rol autor con alcance declarado puede pedir herramientas de edición', () => {
  const base = { id: 'x', writes: ['specs/**'], tools: ['Read', 'Edit'] };
  assert.deepEqual(toolsFor({ ...base, kind: 'author' }), ['Read', 'Edit']);
  assert.throws(() => toolsFor(base), /x/);
  assert.throws(() => toolsFor({ ...base, kind: 'reviewer' }), /x/);
  assert.throws(() => toolsFor({ ...base, kind: 'author', writes: [] }), /x/);
});

for (const [lang, file] of [['es', 'agent.md'], ['en', 'agent.en.md']]) {
  test(`R13 (${lang}): el prompt del analista fija su contrato con el advisor`, async () => {
    const text = await readFile(join(AGENTS_DIR, 'analista', file), 'utf8');
    assert.match(text, /hu\.md/);
    assert.match(text, /\.chalc\/review\.md/);
    assert.match(text, /· analista · OK/);
    assert.match(text, lang === 'es' ? /- Huella: / : /- Fingerprint: /);
    assert.match(text, /FINDINGS: 0/);
    assert.match(text, /\{\{FOLLOWUPS\}\}/);
    assert.match(text, /node \.chalc\/next\.mjs/);
  });

  test(`R26 (${lang}): el prompt del especificador manda leer las reglas del proyecto y no inventar`, async () => {
    const text = await readFile(join(AGENTS_DIR, 'especificador', file), 'utf8');
    for (const needle of ['hu.md', 'CLAUDE.md', 'AGENTS.md', 'specs/constitution.md', 'specs/_template', '[NEEDS CLARIFICATION', 'HU-', 'SHALL', 'node .chalc/next.mjs', '--approve-spec']) {
      assert.ok(text.includes(needle), `${file} debe nombrar ${needle}`);
    }
    assert.match(text, /\{\{SKILLS\}\}/);
  });
}

test('R13, R26: los prompts se proyectan en el idioma del spec con las skills del repo', async () => {
  const especificador = await byId('especificador');
  const es = await roleText(CATALOG, especificador, { skills: ['clean-code'], specLang: 'es' });
  const en = await roleText(CATALOG, especificador, { skills: ['clean-code'], specLang: 'en' });
  assert.equal(es.code, 'es');
  assert.ok(es.text.includes('- `clean-code`') && en.text.includes('- `clean-code`'));
  assert.notEqual(es.text, en.text);
  assert.equal(es.text.includes('{{SKILLS}}'), false);
});

test('R13: en los targets de AGENTS.md la sección dice que el rol entra al preparar la spec', async () => {
  const analista = await byId('analista');
  assert.match((await roleLines(CATALOG, analista, { specLang: 'es' })).join('\n'), /## 🔍 Agente analista \(al preparar la spec\)/);
  assert.match((await roleLines(CATALOG, analista, { specLang: 'en' })).join('\n'), /## 🔍 analista agent \(when preparing the spec\)/);
  const revisor = await byId('revisor');
  assert.match((await roleLines(CATALOG, revisor, { specLang: 'es' })).join('\n'), /\(al cerrar cada tarea\)/);
});

test('R26: como subagente de Claude Code, el especificador recibe Edit y el analista no', async (t) => {
  const dir = await tempDir(t, 'chalc-024-roles-');
  const front = async (id) => (await readFile(await writeRole(dir, CATALOG, await byId(id), { specLang: 'es' }), 'utf8')).split('---')[1];
  assert.match(await front('especificador'), /tools: .*\bEdit\b/);
  assert.doesNotMatch(await front('analista'), /\bEdit\b/);
});

test('R10, R26: gate.json declara los dos roles con su cadencia, y al autor como autor', async (t) => {
  const dir = await tempDir(t, 'chalc-024-roles-');
  const roles = (await detectGateConfig(dir)).flow.roles;
  assert.deepEqual(roles.find((r) => r.id === 'especificador'), { id: 'especificador', order: 0, cadence: 'spec', required: true, kind: 'author' });
  assert.deepEqual(roles.find((r) => r.id === 'analista'), { id: 'analista', order: 1, cadence: 'spec', required: true });
});
