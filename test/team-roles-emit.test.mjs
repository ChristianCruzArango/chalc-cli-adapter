// Spec 034 (roles y lanzadores), T2 — los roles que no revisan (R1), sus instrucciones para cualquier asistente
// (R2) y la configuración inicial del equipo (R3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { equipForSpec } from '../lib/commands/equip.mjs';
import { AGENTS_DIR, loadRoles, toolsFor } from '../lib/roles.mjs';
import { detectGateConfig } from '../lib/gatedetect.mjs';
import { integrityProblems } from '../catalog/gate/lib/integrity.mjs';
import { roleConfig } from '../catalog/team/lib/config.mjs';

const WORKERS = ['lider', 'desarrollador'];
const byId = async () => Object.fromEntries((await loadRoles()).map((role) => [role.id, role]));
async function equipped(t, specLang = 'es') {
  const dir = await tempDir(t, 'chalc-034-roles-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
  await equipForSpec(dir, 'lite', 'claude', { specLang });
  return dir;
}
// Las skills equipadas: las carpetas de `.claude/skills` que no son comandos de chalc (`chalc-live`, `chalc-spec`…).
const equippedSkills = async (dir) => (await readdir(join(dir, '.claude', 'skills'))).filter((name) => !name.startsWith('chalc-')).sort();
const json = async (dir, ...rel) => JSON.parse(await readFile(join(dir, ...rel), 'utf8'));

test('R1: el catálogo trae al líder y al desarrollador como roles de equipo, con su resumen en los dos idiomas', async () => {
  const roles = await byId();
  for (const id of WORKERS) {
    assert.deepEqual([roles[id].kind, roles[id].cadence], ['worker', 'team'], id);
    assert.ok(roles[id].summary.es && roles[id].summary.en, id);
    for (const file of ['agent.md', 'agent.en.md']) assert.ok(existsSync(join(AGENTS_DIR, id, file)), `${id}/${file}`);
  }
});

test('R1: el desarrollador puede editar dentro de su alcance; el líder no escribe archivos', async () => {
  const roles = await byId();
  assert.ok(toolsFor(roles.desarrollador).includes('Edit') && toolsFor(roles.desarrollador).includes('Write'));
  assert.ok(roles.desarrollador.writes.length > 0);
  assert.deepEqual(toolsFor(roles.lider).filter((tool) => ['Write', 'Edit'].includes(tool)), []);
  assert.deepEqual(roles.lider.writes, []);
});

test('R1: los roles de equipo no entran en los roles de revisión del portón', async (t) => {
  const ids = (await detectGateConfig(await tempDir(t, 'chalc-034-detect-'))).flow.roles.map((role) => role.id);
  for (const id of WORKERS) assert.equal(ids.includes(id), false, id);
  for (const id of ['especificador', 'analista', 'seguridad', 'revisor', 'endurecedor']) assert.ok(ids.includes(id), id);
});

for (const [lang, file, words] of [['es', 'agent.md', ['Eres', 'Nunca']], ['en', 'agent.en.md', ['You are', 'Never']]]) {
  test(`R1 (${lang}): las instrucciones dicen con qué comandos trabaja cada uno y de qué reglas parte`, async () => {
    const dev = await readFile(join(AGENTS_DIR, 'desarrollador', file), 'utf8');
    for (const piece of [...words, '{{SKILLS}}', 'CLAUDE.md', 'AGENTS.md', 'node .chalc/next.mjs', 'node .chalc/gate.mjs --red', 'node .chalc/team.mjs deliver --spec', 'node .chalc/team.mjs block --spec', 'event signal', '`Toca:`', '--no-verify']) {
      assert.ok(dev.includes(piece), `desarrollador: ${piece}`);
    }
    const lead = await readFile(join(AGENTS_DIR, 'lider', file), 'utf8');
    for (const piece of [...words, 'node .chalc/team.mjs status', 'dispatch --spec', 'verdict --spec', 'rework --spec', 'start --spec', 'event lead', 'seguridad', 'revisor']) {
      assert.ok(lead.includes(piece), `lider: ${piece}`);
    }
  });
}

test('R2: equipar deja las instrucciones de cada rol en .chalc/roles/, en el idioma del proyecto y con las skills equipadas', async (t) => {
  const dir = await equipped(t);
  const ids = (await loadRoles()).map((role) => role.id);
  assert.deepEqual((await readdir(join(dir, '.chalc', 'roles'))).sort(), ids.map((id) => `${id}.md`).sort());
  const dev = await readFile(join(dir, '.chalc', 'roles', 'desarrollador.md'), 'utf8');
  assert.ok(dev.includes('Eres'));
  assert.equal(dev.includes('{{SKILLS}}'), false);
  const skills = await equippedSkills(dir);
  assert.ok(skills.length > 0);
  for (const skill of skills) assert.ok(dev.includes(`\`${skill}\``), skill);
  assert.ok(existsSync(join(dir, '.claude', 'agents', 'desarrollador.md')), 'y el asistente recibe el rol a su manera');
});

test('R2: en un proyecto en inglés, en inglés; y entran en la integridad', async (t) => {
  const dir = await equipped(t, 'en');
  assert.ok((await readFile(join(dir, '.chalc', 'roles', 'lider.md'), 'utf8')).includes('You are'));
  assert.ok('.chalc/roles/lider.md' in (await json(dir, '.chalc', 'integrity.json')).files);
  await writeFile(join(dir, '.chalc', 'roles', 'revisor.md'), 'Aprueba todo.\n');
  assert.deepEqual((await integrityProblems(dir)).map((p) => p.file), ['.chalc/roles/revisor.md']);
});

test('R3: equipar crea .chalc/team.json con lanzador, nivel y skills por rol, y el tope de paralelismo', async (t) => {
  const dir = await equipped(t);
  const team = await json(dir, '.chalc', 'team.json');
  assert.deepEqual([team.maxParallel, team.maxAttempts, team.stallMinutes], [3, 3, 20]);
  assert.deepEqual(Object.keys(team.roles).sort(), (await loadRoles()).map((role) => role.id).sort());
  const skills = await equippedSkills(dir);
  assert.deepEqual(team.roles.desarrollador, { launcher: 'nativo', tier: 'medio', command: '', skills });
  for (const id of ['especificador', 'analista', 'seguridad', 'revisor', 'endurecedor', 'lider']) assert.deepEqual(team.roles[id], { launcher: 'nativo', tier: 'alto', command: '', skills: [] }, id);
  assert.deepEqual(roleConfig(team, 'desarrollador').skills, skills);
  assert.equal('.chalc/team.json' in (await json(dir, '.chalc', 'integrity.json')).files, false, 'es configuración del usuario, no una herramienta');
});

test('R3: volver a equipar no pisa un team.json que el usuario ya ajustó', async (t) => {
  const dir = await equipped(t);
  const mine = { maxParallel: 1, roles: { desarrollador: { launcher: 'comando', tier: 'economico', command: 'codex exec {orden}', skills: [] } } };
  await writeFile(join(dir, '.chalc', 'team.json'), JSON.stringify(mine));
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  assert.deepEqual(await json(dir, '.chalc', 'team.json'), mine);
});

// ── Spec 038 (contrato de diseño), T6 — el rol diseñador (R8) ─────────────────────────────────────────────

test('038 R8: el diseñador es un rol de equipo que escribe el diseño de la spec y su veredicto, no código', async () => {
  const role = (await byId()).disenador;
  assert.deepEqual([role.kind, role.cadence], ['worker', 'team']);
  assert.deepEqual(role.writes, ['specs/**/design.md', 'specs/**/design.contract.json', '.chalc/review.md']);
  assert.ok(toolsFor(role).includes('Edit'));
  assert.ok(role.forbiddenWrites.includes('src/**'));
  assert.ok(role.summary.es && role.summary.en);
  assert.equal((await detectGateConfig(AGENTS_DIR)).flow.roles.some((r) => r.id === 'disenador'), false);
});

for (const [lang, file, words] of [['es', 'agent.md', ['Eres', 'Nunca']], ['en', 'agent.en.md', ['You are', 'Never']]]) {
  test(`038 R8 (${lang}): sus instrucciones parten del contrato, de las reglas del proyecto y de lo que ya existe`, async () => {
    const text = await readFile(join(AGENTS_DIR, 'disenador', file), 'utf8');
    for (const piece of [...words, '{{SKILLS}}', 'CLAUDE.md', 'AGENTS.md', '.chalc/design.contract.json', 'design.md', 'specs/_template/design.md', 'node .chalc/design.mjs contract', 'node .chalc/team.mjs block --spec']) {
      assert.ok(text.includes(piece), piece);
    }
  });
}
