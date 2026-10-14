// T10 (spec 022, R18, S6/S9/F3) — mutantes de lib/install.mjs, lib/update.mjs y
// lib/commands/updateconfirm.mjs. Fuentes locales en tmp y prompters falsos: cero red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { t } from '../lib/i18n.mjs';
import { classifySource, installSkill } from '../lib/install.mjs';
import { applySkillUpdate, checkSkillUpdate, updateSkills } from '../lib/update.mjs';
import { makeSkillConfirm } from '../lib/commands/updateconfirm.mjs';
import { hashDir } from '../lib/skillsource/hashdir.mjs';

// Prompter falso: responde de una cola por método y registra cada pregunta con su valor por defecto.
function fakePrompter({ yesno = [], multi = [] } = {}) {
  const asked = [];
  return {
    asked,
    yesno: async (q, def) => { asked.push(['yesno', q, def]); return yesno.shift(); },
    multi: async (q, opts, def) => { asked.push(['multi', q, opts, def]); return multi.shift(); }
  };
}

async function writeSkill(dir, body = '# v1\n') {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), body);
  return dir;
}

async function setup(t0) {
  const work = await tempDir(t0, 'chalc-mut-inst-');
  const catalog = join(work, 'catalog');
  await mkdir(join(catalog, 'skills'), { recursive: true });
  return { work, catalog };
}

// ---------- install ----------
test('classifySource: git solo con esquema http(s)/git@ AL INICIO y un host o .git reconocible', () => {
  assert.equal(classifySource('https://example.com/foo'), 'skillssh');
  assert.equal(classifySource('mirror/https://github.com/a/b'), 'skillssh');
  assert.equal(classifySource('https://host.example/repo.git'), 'git');
  assert.equal(classifySource('http://github.com/a/b'), 'git');
  assert.equal(classifySource('git@github.com:a/b.git'), 'git');
});

test('install: ejecutar git externo se pregunta con NO por defecto; un no cancela', async (t0) => {
  const { catalog } = await setup(t0);
  const prompter = fakePrompter({ yesno: [false] });
  const source = 'https://github.com/o/r';
  await assert.rejects(installSkill({ source, CATALOG: catalog, prompter }), { message: t('instCancelled') });
  assert.deepEqual(prompter.asked, [['yesno', t('instExecQ', source, 'git clone'), false]]);
});

test('install: un secreto en la URL se rechaza antes de preguntar nada', async (t0) => {
  const { catalog } = await setup(t0);
  const prompter = fakePrompter({ yesno: [true] });
  await assert.rejects(installSkill({ source: 'https://u:tok@github.com/o/r', CATALOG: catalog, prompter }), { message: t('instUrlCredentials') });
  assert.deepEqual(prompter.asked, []);
});

test('install: una skill con hooks se confirma con NO por defecto; un no la omite', async (t0) => {
  const { work, catalog } = await setup(t0);
  const src = await writeSkill(join(work, 'src', 'risky'), '---\nhooks: x\n---\n');
  const prompter = fakePrompter({ yesno: [false] });
  assert.deepEqual(await installSkill({ source: src, CATALOG: catalog, prompter }), []);
  assert.deepEqual(prompter.asked, [['yesno', t('instRiskyQ', 'risky'), false]]);
});

test('install: reemplazar una existente se pregunta con NO por defecto; no → se conserva, sí → se reemplaza', async (t0) => {
  const { work, catalog } = await setup(t0);
  const src = await writeSkill(join(work, 'src', 'demo'), '# v1\n');
  await installSkill({ source: src, CATALOG: catalog });
  await writeFile(join(src, 'SKILL.md'), '# v2\n');
  const installedMd = join(catalog, 'skills', 'demo', 'SKILL.md');

  const no = fakePrompter({ yesno: [false] });
  const logs = [];
  assert.deepEqual(await installSkill({ source: src, CATALOG: catalog, prompter: no, log: (m) => logs.push(m) }), []);
  assert.deepEqual(no.asked, [['yesno', t('instReplaceQ', 'demo'), false]]);
  assert.deepEqual(logs, [t('instKeepExisting', 'demo')]);
  assert.equal(await readFile(installedMd, 'utf8'), '# v1\n');

  const yes = fakePrompter({ yesno: [true] });
  assert.deepEqual(await installSkill({ source: src, CATALOG: catalog, prompter: yes }), ['demo']);
  assert.equal(await readFile(installedMd, 'utf8'), '# v2\n');
});

test('install: una fuente local no registra commit en el manifiesto', async (t0) => {
  const { work, catalog } = await setup(t0);
  const src = await writeSkill(join(work, 'src', 'demo'));
  await installSkill({ source: src, CATALOG: catalog });
  const meta = JSON.parse(await readFile(join(catalog, 'skills', 'demo', '.chalc-skill.json'), 'utf8'));
  assert.equal('commit' in meta, false);
  assert.equal(meta.sourceType, 'local');
});

test('install: con varias skills se ofrece cada una por su nombre, todas marcadas', async (t0) => {
  const { work, catalog } = await setup(t0);
  const repo = join(work, 'src', 'repo');
  await writeSkill(join(repo, 'skills', 'alpha'));
  await writeSkill(join(repo, 'skills', 'beta'));
  const prompter = fakePrompter({ multi: [[1]] });
  const installed = await installSkill({ source: repo, CATALOG: catalog, prompter });
  const [kind, q, opts, def] = prompter.asked[0];
  assert.equal(kind, 'multi');
  assert.equal(q, t('instPickMany'));
  assert.deepEqual(opts.map((o) => o.label).sort(), ['alpha', 'beta']);
  assert.deepEqual(def, [0, 1]);
  assert.deepEqual(installed, [opts[1].label]);
});

// ---------- update ----------
async function installedLocal(t0) {
  const { work, catalog } = await setup(t0);
  const src = await writeSkill(join(work, 'src', 'demo'), '# v1\n');
  await installSkill({ source: src, CATALOG: catalog });
  return { work, catalog, src };
}

test('update: una fuente local borrada es `source-unavailable`, sin ejecutar nada', async () => {
  const manifest = { source: '/no/existe/chalc-mut/demo', sourceType: 'local' };
  const r = await checkSkillUpdate({ id: 'demo', manifest });
  assert.deepEqual(r, { status: 'error', reason: 'source-unavailable', error: '/no/existe/chalc-mut/demo' });
});

test('update: una skill al día no se confirma; en --check una desactualizada tampoco', async (t0) => {
  const { work, catalog, src } = await installedLocal(t0);
  const asked = [];
  const confirmSkill = async (d) => { asked.push(d.id); return false; };
  const fresh = await updateSkills({ catalog, chalcRoot: work, confirmSkill });
  assert.deepEqual(fresh.results.map((r) => r.status), ['fresh']);
  await writeFile(join(src, 'SKILL.md'), '# v2\n');
  const checked = await updateSkills({ catalog, chalcRoot: work, check: true, confirmSkill });
  assert.deepEqual(checked.results.map((r) => r.status), ['outdated']);
  assert.deepEqual(asked, []);
  const skipped = await updateSkills({ catalog, chalcRoot: work, confirmSkill });
  assert.deepEqual(skipped.results.map((r) => r.status), ['skipped']);
  assert.deepEqual(asked, ['demo']);
});

test('update: aplicar sin commit no lo inventa en el manifiesto', async (t0) => {
  const { work, catalog } = await installedLocal(t0);
  const dir = await writeSkill(join(work, 'nueva', 'demo'), '# v3\n');
  const manifest = { source: dir, sourceType: 'local', installedAt: '2026-01-01T00:00:00Z' };
  await applySkillUpdate({ id: 'demo', catalog, dir, manifest, newHash: await hashDir(dir) });
  const meta = JSON.parse(await readFile(join(catalog, 'skills', 'demo', '.chalc-skill.json'), 'utf8'));
  assert.equal('commit' in meta, false);
});

// ---------- updateconfirm ----------
const files = (n, p = 'f') => Array.from({ length: n }, (_, i) => `${p}${i}`);

async function confirmLines(changes, opts = {}) {
  const out = [];
  const ok = await makeSkillConfirm({ print: (m) => out.push(m), ...opts })({ id: 'demo', changes, ...(opts.risky ? { risky: opts.risky } : {}) });
  return { out, ok };
}

test('updateconfirm: cada grupo con su marca; sin riesgo no hay aviso; sin --yes ni terminal → no', async () => {
  const { out, ok } = await confirmLines({ added: ['a.md'], removed: ['b.md'], modified: ['c.md'] });
  assert.deepEqual(out, [t('updateChanges', 'demo', 1, 1, 1), '    + a.md', '    - b.md', '    ~ c.md']);
  assert.equal(ok, false);
});

test('updateconfirm: tope de 20 por grupo y el resto resumido', async () => {
  const exact = await confirmLines({ added: files(20), removed: [], modified: [] });
  assert.equal(exact.out.length, 21);
  assert.equal(exact.out.at(-1), '    + f19');
  const over = await confirmLines({ added: files(25), removed: [], modified: [] });
  assert.equal(over.out.length, 22);
  assert.equal(over.out.at(-2), '    + f19');
  assert.equal(over.out.at(-1), '    … +5');
});

test('updateconfirm: aviso de riesgo y pregunta con NO por defecto', async () => {
  const prompter = fakePrompter({ yesno: [true] });
  const { out, ok } = await confirmLines({ added: [], removed: [], modified: [] }, { prompter, risky: ['hooks', 'allowed-tools'] });
  assert.deepEqual(out, [t('updateChanges', 'demo', 0, 0, 0), t('updateRisky', 'demo', 'hooks, allowed-tools')]);
  assert.deepEqual(prompter.asked, [['yesno', t('updateSkillQ', 'demo'), false]]);
  assert.equal(ok, true);
});
