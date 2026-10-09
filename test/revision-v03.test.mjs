// V-03 (spec 016, R3) — todo lo que se carga al contexto del prompt (README, instrucciones,
// constitución, arquitectura, plantilla de spec, skills, notas de carpeta) pasa por un lector único:
// ruta real confinada a la raíz, bytes acotados y secretos redactados antes del adaptador del modelo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession } from '../cli/session.mjs';
import { buildProjectSections, readSection } from '../cli/sessioncontext.mjs';
import { loadSkillMetas, buildSkillSections } from '../cli/skills/loader.mjs';
import { readForPrompt } from '../cli/tools/saferead.mjs';

const FAKE_KEY = 'sk-proj-AUDIT_FAKE_SECRET_NOT_VALID_123456789';
const OUTSIDE_MARK = 'OUTSIDE_FILE_MARKER';

// base/outside.md (fuera) y base/repo (raíz del proyecto)
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'chalc-v03-'));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(base, 'outside.md'), `${OUTSIDE_MARK} apiKey ${FAKE_KEY}\n`);
  return { base, root, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const promptOf = async (root) => {
  let observed = '';
  const chatImpl = async ({ system, user }) => { observed = `${system}\n${user}`; return JSON.stringify({ thought: 't', done: true, summary: 'OK' }); };
  const session = await createSession({ projectPath: root, cfg: { provider: 'ollama', model: 'audit' }, language: 'es', chatImpl });
  await session.ask('Resume el proyecto');
  await session.close();
  return observed;
};

test('R3: a README.md symlink to a file outside the project never reaches the model', async () => {
  const { root, cleanup } = await fixture();
  try {
    await symlink('../outside.md', join(root, 'README.md'));
    const prompt = await promptOf(root);
    assert.ok(prompt.length > 0);
    assert.ok(!prompt.includes(OUTSIDE_MARK));
    assert.ok(!prompt.includes(FAKE_KEY));
  } finally { await cleanup(); }
});

test('R3: a recognizable key inside an in-project README is redacted before the model', async () => {
  const { root, cleanup } = await fixture();
  try {
    await writeFile(join(root, 'README.md'), `# Demo\nINSIDE_README_MARKER key ${FAKE_KEY}\n`);
    const prompt = await promptOf(root);
    assert.ok(prompt.includes('INSIDE_README_MARKER'));
    assert.ok(!prompt.includes(FAKE_KEY));
  } finally { await cleanup(); }
});

test('R3: rules, constitution and architecture symlinked outside are dropped; inside ones load redacted', async () => {
  const { root, cleanup } = await fixture();
  try {
    await mkdir(join(root, 'specs'));
    await mkdir(join(root, 'docs'));
    await symlink('../outside.md', join(root, 'CLAUDE.md'));
    await symlink('../../outside.md', join(root, 'specs', 'constitution.md'));
    await writeFile(join(root, 'docs', 'architecture.md'), `ARCH_MARKER ${FAKE_KEY}\n`);
    const project = {
      projectPath: root, equipped: true, stacks: [],
      paths: { rulesFile: join(root, 'CLAUDE.md'), constitution: join(root, 'specs', 'constitution.md'), architecture: join(root, 'docs', 'architecture.md') },
      detected: { skills: [], mcpServers: [] }
    };
    const text = (await buildProjectSections(project, 'es')).map((s) => s.text).join('\n');
    assert.ok(!text.includes(OUTSIDE_MARK));
    assert.ok(text.includes('ARCH_MARKER'));
    assert.ok(!text.includes(FAKE_KEY));
  } finally { await cleanup(); }
});

test('R3: folder README notes and the spec template go through the same reader', async () => {
  const { root, cleanup } = await fixture();
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'README.md'), `NOTE_MARKER ${FAKE_KEY}\n`);
    const project = { projectPath: root, equipped: false, stacks: [], paths: {}, detected: { skills: [], mcpServers: [] } };
    const text = (await buildProjectSections(project, 'es')).map((s) => s.text).join('\n');
    assert.ok(text.includes('NOTE_MARKER'));
    assert.ok(!text.includes(FAKE_KEY));

    await mkdir(join(root, 'specs', '_template'), { recursive: true });
    await symlink('../../../outside.md', join(root, 'specs', '_template', 'spec.md'));
    const tpl = await readSection(root, join(root, 'specs', '_template', 'spec.md'), { key: 'spec-template', title: 'T', required: true, maxChars: 2500 });
    assert.equal(tpl, null);
  } finally { await cleanup(); }
});

test('R3: readSection keeps the title, truncation and required flag', async () => {
  const { root, cleanup } = await fixture();
  try {
    await writeFile(join(root, 'doc.md'), 'x'.repeat(50));
    const s = await readSection(root, join(root, 'doc.md'), { key: 'k', title: 'Title', required: true, maxChars: 10 });
    assert.deepEqual(s, { key: 'k', required: true, text: `### Title\n${'x'.repeat(10)}\n[…truncated]` });
    assert.equal(await readSection(root, null, { key: 'k', title: 'T' }), null);
    await writeFile(join(root, 'empty.md'), '  \n');
    assert.equal(await readSection(root, join(root, 'empty.md'), { key: 'k', title: 'T' }), null);
  } finally { await cleanup(); }
});

test('R3: an equipped skill whose SKILL.md links outside the project is neither indexed nor loaded', async () => {
  const { root, cleanup } = await fixture();
  try {
    const skillsDir = join(root, '.claude', 'skills');
    await mkdir(join(skillsDir, 'evil'), { recursive: true });
    await mkdir(join(skillsDir, 'good'), { recursive: true });
    await writeFile(join(join(root, '..'), 'outside-skill.md'), `---\nname: evil\ndescription: ${OUTSIDE_MARK}\n---\n${OUTSIDE_MARK}\n`);
    await symlink('../../../../outside-skill.md', join(skillsDir, 'evil', 'SKILL.md'));
    await writeFile(join(skillsDir, 'good', 'SKILL.md'), `---\nname: good\ndescription: good skill\n---\nGOOD_BODY ${FAKE_KEY}\n`);
    const project = { projectPath: root, equipped: true, paths: { skillsDir }, detected: { skills: ['evil', 'good'] } };
    const metas = await loadSkillMetas(project);
    const text = (await buildSkillSections(metas, { task: 'good evil', language: 'es' })).map((s) => s.text).join('\n');
    assert.ok(!text.includes(OUTSIDE_MARK));
    assert.ok(text.includes('GOOD_BODY'));
    assert.ok(!text.includes(FAKE_KEY));
  } finally { await cleanup(); }
});

test('R3: a skill may link to another file inside the project (confinement is the project root)', async () => {
  const { root, cleanup } = await fixture();
  try {
    const skillsDir = join(root, '.claude', 'skills');
    await mkdir(join(skillsDir, 'shared'), { recursive: true });
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'skill.md'), '---\nname: shared\ndescription: shared skill\n---\nSHARED_BODY\n');
    await symlink('../../../docs/skill.md', join(skillsDir, 'shared', 'SKILL.md'));
    const project = { projectPath: root, equipped: true, paths: { skillsDir }, detected: { skills: ['shared'] } };
    const metas = await loadSkillMetas(project);
    assert.equal(metas[0].description, 'shared skill');
    const text = (await buildSkillSections(metas, { task: 'shared', language: 'es' })).map((s) => s.text).join('\n');
    assert.ok(text.includes('SHARED_BODY'));
  } finally { await cleanup(); }
});

test('R3: readForPrompt confines, caps bytes and uses full redaction for secret files (real path)', async () => {
  const { base, root, cleanup } = await fixture();
  try {
    assert.equal(await readForPrompt(root, join(base, 'outside.md')), null);
    assert.equal(await readForPrompt(root, join(root, 'missing.md')), null);
    await writeFile(join(root, 'big.md'), 'a'.repeat(100));
    assert.equal(await readForPrompt(root, join(root, 'big.md'), { maxBytes: 10 }), 'a'.repeat(10));
    await writeFile(join(root, '.env'), 'DB_PASSWORD=AUDIT_FAKE_PASSWORD_2026\n');
    await symlink('.env', join(root, 'notes.md'));
    assert.ok(!(await readForPrompt(root, join(root, 'notes.md'))).includes('AUDIT_FAKE_PASSWORD_2026'));
    assert.ok(!(await readForPrompt(root, join(root, '.env'))).includes('AUDIT_FAKE_PASSWORD_2026'));
    await writeFile(join(root, 'plain.txt'), 'API_TOKEN=AUDIT_FAKE_TOKEN_2026\n');
    await symlink('plain.txt', join(root, '.env.local'));
    assert.ok(!(await readForPrompt(root, join(root, '.env.local'))).includes('AUDIT_FAKE_TOKEN_2026'));
    await writeFile(join(root, 'code.md'), 'const token = getToken();\n');
    assert.equal(await readForPrompt(root, join(root, 'code.md')), 'const token = getToken();\n');
  } finally { await cleanup(); }
});
