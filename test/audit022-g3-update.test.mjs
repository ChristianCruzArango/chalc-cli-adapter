// test/audit022-g3-update.test.mjs — cierre de auditoría (spec 022), grupo G3: `chalc update`.
// Fuentes locales en tmp o un `exec` fake de git: cero red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { installSkill } from '../lib/install.mjs';
import { listInstalledSkills, checkSkillUpdate, applySkillUpdate, updateSkills, writeSkillsLock } from '../lib/update.mjs';
import { makeSkillConfirm } from '../lib/commands/updateconfirm.mjs';
import { t } from '../lib/i18n.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

async function setup(t0) {
  const work = await tempDir(t0, 'chalc-g3-upd-');
  const catalog = join(work, 'catalog');
  const src = join(work, 'src', 'demo');
  await mkdir(join(catalog, 'skills'), { recursive: true });
  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'SKILL.md'), '# v1\n');
  await writeFile(join(src, 'viejo.md'), 'x\n');
  await installSkill({ source: src, CATALOG: catalog });
  return { work, catalog, src };
}

// T3 (spec 022, R18, F16)
test('F16: listInstalledSkills ignora los restos de staging que empiezan por punto', async (t0) => {
  const { catalog } = await setup(t0);
  await mkdir(join(catalog, 'skills', '.demo.1234.next'), { recursive: true });
  await writeFile(join(catalog, 'skills', '.demo.1234.next', 'SKILL.md'), '# x\n');
  const { installed, builtins } = await listInstalledSkills(catalog);
  assert.deepEqual(installed.map((s) => s.id), ['demo']);
  assert.deepEqual(builtins, []);
});

// T3 (spec 022, R18, F4)
test('F4: update conserva el commit de la fuente git en el manifiesto', async (t0) => {
  const { catalog } = await setup(t0);
  const exec = (file, args) => {
    if (args[0] === 'clone') {
      const dir = join(args.at(-1), 'demo');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), '# v2\n');
    }
    return args.includes('rev-parse') ? SHA + '\n' : '';
  };
  const manifest = { id: 'demo', source: 'https://github.com/o/r', sourceType: 'git', commit: 'viejo', contentSha256: 'x', hashVersion: 2, installedAt: '2026-01-01T00:00:00Z' };
  const r = await checkSkillUpdate({ id: 'demo', manifest, exec });
  assert.equal(r.status, 'outdated');
  assert.equal(r.commit, SHA);
  try {
    await applySkillUpdate({ id: 'demo', catalog, dir: r.dir, manifest, newHash: r.newHash, commit: r.commit });
  } finally { await rm(r.cleanup, { recursive: true, force: true }); }
  const meta = JSON.parse(await readFile(join(catalog, 'skills', 'demo', '.chalc-skill.json'), 'utf8'));
  assert.equal(meta.commit, SHA);
});

// T3 (spec 022, R13, S6)
test('S6: update pide confirmación POR skill con el resumen de archivos cambiados; un "no" la omite', async (t0) => {
  const { catalog, src } = await setup(t0);
  await writeFile(join(src, 'SKILL.md'), '---\nname: demo\nallowed-tools: Bash\n---\n# v2\n');
  await rm(join(src, 'viejo.md'));
  await writeFile(join(src, 'nuevo.md'), 'n\n');
  const seen = [];
  const { results, lockWritten } = await updateSkills({ catalog, confirmSkill: async (info) => { seen.push(info); return false; } });
  assert.deepEqual(seen, [{ id: 'demo', changes: { added: ['nuevo.md'], removed: ['viejo.md'], modified: ['SKILL.md'] }, risky: ['allowed-tools'] }]);
  assert.equal(results[0].status, 'skipped');
  assert.equal(lockWritten, false);
  assert.equal(readFileSync(join(catalog, 'skills', 'demo', 'SKILL.md'), 'utf8'), '# v1\n');
  const again = await updateSkills({ catalog, confirmSkill: async () => true });
  assert.equal(again.results[0].status, 'updated');
  assert.equal(existsSync(join(catalog, 'skills', 'demo', 'viejo.md')), false);
});

// T3 (spec 022, R13, S6)
test('S6: el confirmador del comando muestra el resumen y aplica sin preguntar solo con --yes', async () => {
  const info = { id: 'demo', changes: { added: ['a.md'], removed: [], modified: ['SKILL.md'] }, risky: ['hooks'] };
  const printed = [];
  const print = (m) => printed.push(m);
  assert.equal(await makeSkillConfirm({ prompter: null, assumeYes: false, print })(info), false);
  assert.equal(await makeSkillConfirm({ prompter: null, assumeYes: true, print })(info), true);
  const out = printed.join('\n');
  assert.ok(out.includes(t('updateChanges', 'demo', 1, 0, 1)), out);
  assert.ok(out.includes('a.md') && out.includes('SKILL.md'));
  assert.ok(out.includes(t('updateRisky', 'demo', 'hooks')));
  const asked = [];
  const ok = await makeSkillConfirm({ prompter: { yesno: async (q) => { asked.push(q); return true; } }, assumeYes: false, print })(info);
  assert.equal(ok, true);
  assert.deepEqual(asked, [t('updateSkillQ', 'demo')]);
});

// T3 (spec 022, R17, S9)
test('S9: el lock no publica credenciales de una fuente heredada con usuario:contraseña en la URL', async (t0) => {
  const { work, catalog } = await setup(t0);
  const file = join(catalog, 'skills', 'demo', '.chalc-skill.json');
  const meta = JSON.parse(await readFile(file, 'utf8'));
  meta.source = 'https://user:s3creto@gitlab.example.com/o/r.git';
  meta.sourceType = 'git';
  await writeFile(file, JSON.stringify(meta));
  const lock = await readFile(await writeSkillsLock(work, catalog), 'utf8');
  assert.doesNotMatch(lock, /s3creto|user:/);
  assert.match(lock, /https:\/\/gitlab\.example\.com\/o\/r\.git/);
  // Y la actualización la rechaza sin ejecutar nada ni repetir el secreto.
  let ran = false;
  const r = await checkSkillUpdate({ id: 'demo', manifest: meta, exec: () => { ran = true; return ''; } });
  assert.equal(r.status, 'error');
  assert.equal(ran, false);
  assert.doesNotMatch(String(r.error), /s3creto/);
});
