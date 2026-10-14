// test/audit022-g3-install.test.mjs — cierre de auditoría (spec 022), grupo G3: instalación de skills.
// Sin red ni npx reales: `exec` es un fake inyectado que imita a git/npx escribiendo en disco.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { installSkill, fetchSkillSource } from '../lib/install.mjs';
import { t } from '../lib/i18n.mjs';

const SHA = 'abc1234def5678abc1234def5678abc1234def56';

// Imita a git: `clone` deja <dest>/demo/SKILL.md; `rev-parse` devuelve SHA.
function fakeGit(calls, files = { 'SKILL.md': '# demo\n' }) {
  return (file, args, opts = {}) => {
    calls.push({ file, args, opts });
    if (args[0] === 'clone') {
      const dir = join(args.at(-1), 'demo');
      mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    }
    if (args.includes('rev-parse')) return SHA + '\n';
    return '';
  };
}

// Imita a `npx skills add`: deja la skill en <cwd>/.agents/skills/demo.
function fakeNpx(calls, write = (cwd) => {
  const dir = join(cwd, '.agents', 'skills', 'demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '# demo\n');
}) {
  return (file, args, opts = {}) => {
    calls.push({ file, args, opts });
    write(opts.cwd);
    return '';
  };
}

async function catalogIn(t0) {
  const catalog = join(await tempDir(t0, 'chalc-g3-'), 'catalog');
  await mkdir(join(catalog, 'skills'), { recursive: true });
  return catalog;
}

// T3 (spec 022, R7, S2)
test('S2: git clone recibe childEnv: CHALC_API_KEY no llega al hijo y no hay prompt de terminal', async (t0) => {
  const catalog = await catalogIn(t0);
  const calls = [];
  process.env.CHALC_API_KEY = 'sk-secreta';
  try {
    await installSkill({ source: 'https://github.com/o/r', CATALOG: catalog, allowExternalExec: true, exec: fakeGit(calls) });
  } finally { delete process.env.CHALC_API_KEY; }
  const clone = calls.find((c) => c.args[0] === 'clone');
  assert.ok(clone.opts.env, 'el clone debe recibir un env explícito');
  assert.equal(clone.opts.env.CHALC_API_KEY, undefined);
  assert.equal(clone.opts.env.GIT_TERMINAL_PROMPT, '0');
  for (const c of calls) assert.equal(c.opts.env?.CHALC_API_KEY, undefined);
});

// T3 (spec 022, R7, R8, S2)
test('S2: npx skills add recibe childEnv y un timeout de 300 s', async (t0) => {
  const catalog = await catalogIn(t0);
  const home = await tempDir(t0, 'chalc-g3-home-');
  const calls = [];
  process.env.CHALC_API_KEY = 'sk-secreta';
  try {
    await installSkill({ source: 'npx skills add o/r --skill demo', CATALOG: catalog, allowExternalExec: true, exec: fakeNpx(calls), home });
  } finally { delete process.env.CHALC_API_KEY; }
  assert.equal(calls.length, 1);
  assert.ok(calls[0].opts.env, 'npx debe recibir un env explícito');
  assert.equal(calls[0].opts.env.CHALC_API_KEY, undefined);
  assert.equal(calls[0].opts.timeout, 300000);
});

// T3 (spec 022, R17, S9)
test('S9: una fuente con credenciales en la URL se rechaza sin ejecutar nada y sin repetir el secreto', async (t0) => {
  const catalog = await catalogIn(t0);
  for (const source of ['https://user:tok3n@gitlab.example.com/o/r.git', 'https://tok3n@github.com/o/r', 'npx skills add https://u:tok3n@host.example/o/r.git']) {
    const calls = [];
    const logs = [];
    const err = await installSkill({ source, CATALOG: catalog, allowExternalExec: true, exec: fakeGit(calls), log: (m) => logs.push(m) }).catch((e) => e);
    assert.ok(err instanceof Error, source);
    assert.equal(err.message, t('instUrlCredentials'));
    assert.doesNotMatch(err.message + logs.join('\n'), /tok3n/);
    assert.equal(calls.length, 0, 'no se ejecuta git/npx');
  }
  // `git@host:…` (usuario SSH, sin secreto) sigue siendo válido.
  const calls = [];
  await installSkill({ source: 'git@github.com:o/r.git', CATALOG: catalog, allowExternalExec: true, exec: fakeGit(calls) });
  assert.ok(calls.length > 0);
});

// T3 (spec 022, R13, S6)
test('S6: una fuente git fijada con @<commit> clona completo, hace checkout de ese commit y lo registra', async (t0) => {
  const catalog = await catalogIn(t0);
  const calls = [];
  const source = 'https://github.com/o/r@abc1234';
  await installSkill({ source, CATALOG: catalog, allowExternalExec: true, exec: fakeGit(calls) });
  const clone = calls.find((c) => c.args[0] === 'clone');
  assert.ok(!clone.args.includes('--depth'), 'un commit fijo no se alcanza con --depth 1');
  assert.ok(clone.args.includes('https://github.com/o/r.git'));
  const checkout = calls.find((c) => c.args.includes('checkout'));
  assert.ok(checkout && checkout.args.includes('abc1234'));
  const meta = JSON.parse(await readFile(join(catalog, 'skills', 'demo', '.chalc-skill.json'), 'utf8'));
  assert.equal(meta.source, source);
  assert.equal(meta.commit, SHA);
});

// T3 (spec 022, R13, S6)
test('S6: un commit fijado que no coincide con el HEAD obtenido se rechaza', async (t0) => {
  const catalog = await catalogIn(t0);
  await assert.rejects(
    () => installSkill({ source: 'https://github.com/o/r@fff0000', CATALOG: catalog, allowExternalExec: true, exec: fakeGit([]) }),
    { message: t('instPinMismatch', 'fff0000') }
  );
});

// T3 (spec 022, R13, S6)
test('S6: una skill que declara allowed-tools u hooks se avisa, y con prompter se pide confirmación', async (t0) => {
  const catalog = await catalogIn(t0);
  const src = join(await tempDir(t0, 'chalc-g3-src-'), 'riesgo');
  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'SKILL.md'), '---\nname: riesgo\nallowed-tools: Bash\nhooks:\n  Stop: x\n---\n# r\n');
  const logs = [];
  const asked = [];
  const prompter = { yesno: async (q) => { asked.push(q); return false; } };
  const ids = await installSkill({ source: src, CATALOG: catalog, prompter, log: (m) => logs.push(m) });
  assert.deepEqual(ids, []);
  assert.ok(logs.includes(t('instRiskyFrontmatter', 'riesgo', 'allowed-tools, hooks')), logs.join('\n'));
  assert.ok(asked.includes(t('instRiskyQ', 'riesgo')));
  assert.equal(existsSync(join(catalog, 'skills', 'riesgo')), false);
  // Sin prompter: avisa y sigue (no bloquea instalaciones no interactivas).
  const logs2 = [];
  assert.deepEqual(await installSkill({ source: src, CATALOG: catalog, log: (m) => logs2.push(m) }), ['riesgo']);
  assert.ok(logs2.includes(t('instRiskyFrontmatter', 'riesgo', 'allowed-tools, hooks')));
});

// T3 (spec 022, R18, F3)
test('F3: reinstalar con --force reemplaza (no mezcla): lo que la fuente retiró desaparece', async (t0) => {
  const catalog = await catalogIn(t0);
  const src = join(await tempDir(t0, 'chalc-g3-src-'), 'dup');
  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'SKILL.md'), '# v1\n');
  await writeFile(join(src, 'viejo.md'), 'retirado\n');
  await installSkill({ source: src, CATALOG: catalog });
  await writeFile(join(src, 'SKILL.md'), '# v2\n');
  const { rm } = await import('node:fs/promises');
  await rm(join(src, 'viejo.md'));
  await installSkill({ source: src, CATALOG: catalog, force: true });
  const dest = join(catalog, 'skills', 'dup');
  assert.equal(existsSync(join(dest, 'viejo.md')), false);
  assert.equal(readFileSync(join(dest, 'SKILL.md'), 'utf8'), '# v2\n');
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual((await readdir(join(catalog, 'skills'))).filter((n) => n.startsWith('.')), [], 'sin restos de staging');
});

// T3 (spec 022, R18, F14)
test('F14: una skill del usuario con el mismo id que skills sobrescribe en ~/.claude se detecta y se restaura', async (t0) => {
  const home = await tempDir(t0, 'chalc-g3-home-');
  const mine = join(home, '.claude', 'skills', 'demo');
  await mkdir(mine, { recursive: true });
  await writeFile(join(mine, 'SKILL.md'), '# la mia\n');
  const exec = fakeNpx([], () => writeFileSync(join(mine, 'SKILL.md'), '# remota\n'));
  const r = await fetchSkillSource('npx skills add o/r --skill demo', { exec, home });
  try {
    assert.equal(r.dirs.length, 1);
    assert.equal(readFileSync(join(r.dirs[0], 'SKILL.md'), 'utf8'), '# remota\n');
    assert.equal(readFileSync(join(mine, 'SKILL.md'), 'utf8'), '# la mia\n', 'la del usuario se restaura');
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(r.cleanup, { recursive: true, force: true });
  }
});

// T3 (spec 022, R18, F14)
test('F14: el fallback por --skill no vendoriza una skill local intacta del usuario', async (t0) => {
  const home = await tempDir(t0, 'chalc-g3-home-');
  const mine = join(home, '.claude', 'skills', 'demo');
  await mkdir(mine, { recursive: true });
  await writeFile(join(mine, 'SKILL.md'), '# la mia\n');
  const exec = fakeNpx([], () => {});   // la CLI no dejó nada nuevo
  await assert.rejects(() => fetchSkillSource('npx skills add o/r --skill demo', { exec, home }), { message: t('instSkillsAddEmpty') });
});

// T3 (spec 022, R19, C2)
test('C2: las preguntas de install salen por t() en el idioma activo', async (t0) => {
  const catalog = await catalogIn(t0);
  const root = await tempDir(t0, 'chalc-g3-src-');
  for (const id of ['uno', 'dos']) {
    await mkdir(join(root, 'pack', id), { recursive: true });
    await writeFile(join(root, 'pack', id, 'SKILL.md'), `# ${id}\n`);
  }
  const asked = [];
  const logs = [];
  const prompter = {
    multi: async (q, opts) => { asked.push(q); return opts.map((_, i) => i); },
    yesno: async (q) => { asked.push(q); return false; }
  };
  await installSkill({ source: join(root, 'pack'), CATALOG: catalog, prompter });
  await installSkill({ source: join(root, 'pack'), CATALOG: catalog, prompter, log: (m) => logs.push(m) });
  assert.ok(asked.includes(t('instPickMany')));
  assert.ok(asked.includes(t('instReplaceQ', 'uno')));
  assert.ok(logs.includes(t('instKeepExisting', 'uno')));
  const gitAsked = [];
  await installSkill({ source: 'https://github.com/o/r', CATALOG: catalog, prompter: { yesno: async (q) => { gitAsked.push(q); return false; } }, exec: fakeGit([]) }).catch(() => {});
  assert.deepEqual(gitAsked, [t('instExecQ', 'https://github.com/o/r', 'git clone')]);
});
