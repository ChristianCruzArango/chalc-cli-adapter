// T10 (spec 022, R18, S2/S6/F3/F14) — mutantes de lib/skillsource con E/S: git, skillssh, snapshot y swap.
// Sin red ni npx: `exec` fake que escribe en la temporal y HOME falso en tmp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { t } from '../lib/i18n.mjs';
import { gitFetch } from '../lib/skillsource/git.mjs';
import { SKILLS_CLI, SKILLS_TIMEOUT, skillsShFetch } from '../lib/skillsource/skillssh.mjs';
import { collectChanges, fingerprint, snapshotRoots } from '../lib/skillsource/snapshot.mjs';
import { replaceDir } from '../lib/skillsource/swap.mjs';
import { hashDir } from '../lib/skillsource/hashdir.mjs';

const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const POSIX = { skip: process.platform === 'win32' };

// Un `git` falso: registra cada llamada, `onClone(dest)` llena el clon y rev-parse devuelve `commit`.
function fakeGit({ commit = SHA, onClone = () => {} } = {}) {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (args[0] === 'clone') onClone(args.at(-1));
    if (args.includes('rev-parse')) {
      if (commit instanceof Error) throw commit;
      return `${commit}\n`;
    }
    return '';
  };
  return { exec, calls };
}

async function fetchGit(t0, url, fake) {
  const logs = [];
  const r = await gitFetch(url, { exec: fake.exec, log: (m) => logs.push(m) });
  t0.after(() => rm(r.cleanup, { recursive: true, force: true }));
  return { r, logs };
}

// ---------- git ----------
test('git: URL de GitHub se normaliza y se clona superficial, con entorno y tope', async (t0) => {
  const fake = fakeGit();
  const { r, logs } = await fetchGit(t0, 'https://github.com/owner/repo', fake);
  const repo = 'https://github.com/owner/repo.git';
  assert.ok(basename(r.cleanup).startsWith('chalc-git-'));
  assert.equal(r.dir, r.cleanup);
  assert.equal(r.commit, SHA);
  assert.deepEqual(logs, [`git clone ${repo} …`]);
  assert.equal(fake.calls.length, 2);
  const [clone, rev] = fake.calls;
  assert.equal(clone.cmd, 'git');
  assert.deepEqual(clone.args, ['clone', '--depth', '1', '--', repo, r.cleanup]);
  assert.equal(clone.opts.stdio, 'ignore');
  assert.equal(clone.opts.timeout, 120000);
  assert.equal(clone.opts.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(rev.cmd, 'git');
  assert.deepEqual(rev.args, ['-C', r.cleanup, 'rev-parse', 'HEAD']);
  assert.equal(rev.opts.encoding, 'utf8');
  assert.equal(rev.opts.timeout, 120000);
});

test('git: /tree/<ref>/<subruta> clona esa rama y devuelve la subcarpeta', async (t0) => {
  const fake = fakeGit({ onClone: (d) => mkdirSync(join(d, 'skills', 'foo'), { recursive: true }) });
  const { r, logs } = await fetchGit(t0, 'https://github.com/owner/repo/tree/main/skills/foo', fake);
  const repo = 'https://github.com/owner/repo.git';
  assert.deepEqual(fake.calls[0].args, ['clone', '--depth', '1', '--branch', 'main', '--', repo, r.cleanup]);
  assert.equal(r.dir, join(r.cleanup, 'skills', 'foo'));
  assert.deepEqual(logs, [`git clone ${repo} @ main …`]);
});

test('git: con pin clona la historia y hace checkout del commit fijado', async (t0) => {
  const fake = fakeGit({ commit: SHA.toUpperCase() });
  const { r, logs } = await fetchGit(t0, 'https://github.com/owner/repo@abcdef1', fake);
  const repo = 'https://github.com/owner/repo.git';
  assert.deepEqual(fake.calls.map((c) => c.args), [
    ['clone', '--', repo, r.cleanup],
    ['-C', r.cleanup, 'checkout', '--detach', 'abcdef1'],
    ['-C', r.cleanup, 'rev-parse', 'HEAD']
  ]);
  const checkout = fake.calls[1];
  assert.equal(checkout.cmd, 'git');
  assert.equal(checkout.opts.stdio, 'ignore');
  assert.equal(checkout.opts.timeout, 120000);
  assert.equal(checkout.opts.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(r.commit, SHA.toUpperCase());
  assert.deepEqual(logs, [`git clone ${repo} # abcdef1 …`]);
});

test('git: URLs que no son de GitHub (o con más ruta) se clonan tal cual', async (t0) => {
  for (const url of ['https://gitlab.com/a/b.git', 'https://github.com/o/r/extra']) {
    const fake = fakeGit();
    const { r } = await fetchGit(t0, url, fake);
    assert.deepEqual(fake.calls[0].args, ['clone', '--depth', '1', '--', url, r.cleanup]);
  }
});

test('git: si rev-parse falla el commit queda vacío', async (t0) => {
  const { r } = await fetchGit(t0, 'https://github.com/owner/repo', fakeGit({ commit: new Error('sin HEAD') }));
  assert.equal(r.commit, '');
});

test('git: ref o subruta que parecen flags, o con `..`, se rechazan sin ejecutar nada', async () => {
  const cases = [
    ['https://github.com/o/r/tree/-x/y', t('instBadRef', '-x')],
    ['https://github.com/o/r/tree/main/-x', t('instBadSubpath', '-x')],
    ['https://github.com/o/r/tree/main/a/../b', t('instBadSubpath', 'a/../b')]
  ];
  for (const [url, message] of cases) {
    const fake = fakeGit();
    await assert.rejects(gitFetch(url, { exec: fake.exec }), { message });
    assert.equal(fake.calls.length, 0, url);
  }
});

// La temporal (con archivos dentro) se borra si algo falla después del clon.
async function failingFetch(url, fake, message) {
  await assert.rejects(gitFetch(url, { exec: fake.exec }), { message });
  const tmp = fake.calls[0].args.at(-1);
  assert.equal(existsSync(tmp), false, 'la temporal no queda huérfana');
}

test('git: subruta inexistente → error claro y temporal borrada', async () => {
  const fake = fakeGit({ onClone: (d) => writeFileSync(join(d, 'README.md'), 'x') });
  await failingFetch('https://github.com/o/r/tree/main/skills/nope', fake, t('instMissingSubpath', 'skills/nope'));
});

test('git: subruta que por un enlace sale del clon → rechazada', POSIX, async (t0) => {
  const outside = await tempDir(t0);
  const fake = fakeGit({
    onClone: (d) => {
      mkdirSync(join(d, 'skills'), { recursive: true });
      writeFileSync(join(d, 'README.md'), 'x');
      symlinkSync(outside, join(d, 'skills', 'evil'));
    }
  });
  await failingFetch('https://github.com/o/r/tree/main/skills/evil', fake, t('instOutsideSubpath', 'skills/evil'));
});

test('git: commit distinto del pin → error y temporal borrada', async () => {
  const fake = fakeGit({ commit: '0000000000', onClone: (d) => writeFileSync(join(d, 'README.md'), 'x') });
  await failingFetch('https://github.com/o/r@abcdef1', fake, t('instPinMismatch', 'abcdef1'));
});

// ---------- skillssh ----------
// Un `npx` falso: registra la llamada y deja lo que `onRun(cwd)` escriba.
function fakeNpx(onRun = () => {}) {
  const calls = [];
  const exec = (cmd, args, opts) => { calls.push({ cmd, args, opts }); onRun(opts.cwd); return ''; };
  return { exec, calls };
}

const addLocal = (id) => (cwd) => {
  mkdirSync(join(cwd, '.agents', 'skills', id), { recursive: true });
  writeFileSync(join(cwd, '.agents', 'skills', id, 'SKILL.md'), `# ${id}\n`);
};

async function fetchSh(t0, source, fake, home) {
  const logs = [];
  const r = await skillsShFetch(source, { exec: fake.exec, log: (m) => logs.push(m), home: home ?? await tempDir(t0) });
  t0.after(() => rm(r.cleanup, { recursive: true, force: true }));
  return { r, logs };
}

test('skillssh: llama a npx con la CLI fijada, en la temporal, con tope; recoge .agents/skills', POSIX, async (t0) => {
  const fake = fakeNpx(addLocal('foo'));
  const { r, logs } = await fetchSh(t0, 'owner/repo', fake);
  assert.ok(basename(r.cleanup).startsWith('chalc-skills-'));
  assert.equal(fake.calls[0].cmd, 'npx');
  assert.deepEqual(fake.calls[0].args, ['--yes', SKILLS_CLI, 'add', 'owner/repo']);
  assert.equal(fake.calls[0].opts.cwd, r.cleanup);
  assert.equal(fake.calls[0].opts.stdio, 'inherit');
  assert.equal(fake.calls[0].opts.timeout, SKILLS_TIMEOUT);
  assert.deepEqual(r.dirs, [join(r.cleanup, '.agents', 'skills', 'foo')]);
  assert.deepEqual(logs, [`npx ${SKILLS_CLI} add owner/repo …`]);
});

test('skillssh: la línea `npx skills add …` se reescribe con la versión fijada', POSIX, async (t0) => {
  const cases = [
    ['npx skills add o/r --skill "my skill"', ['add', 'o/r', '--skill', 'my skill']],
    ['npx --yes skills add o/r', ['add', 'o/r']],
    ['npx -y add-skill o/r', ['add', 'o/r']],
    ['npx add-skill o/r', ['add', 'o/r']],
    ['-y skills add x', ['add', 'x']],
    ["skills@1.2.3 add 'a b' c", ['add', 'a b', 'c']],
    ['skillsfoo add x', ['add', 'skillsfoo add x']],
    ['xskills add x', ['add', 'xskills add x']],
    ['npx skills list', ['add', 'npx skills list']]
  ];
  for (const [source, rest] of cases) {
    const fake = fakeNpx(addLocal('foo'));
    await fetchSh(t0, source, fake);
    assert.deepEqual(fake.calls[0].args, ['--yes', SKILLS_CLI, ...rest], source);
  }
});

test('skillssh: lo que la CLI deja en ~/.claude y ~/.codex se lleva aparte y el HOME queda como estaba', POSIX, async (t0) => {
  const home = await tempDir(t0);
  const mine = join(home, '.claude', 'skills', 'mine');
  await mkdir(join(mine, 'sub'), { recursive: true });
  await writeFile(join(mine, 'sub', 'SKILL.md'), 'MIO\n');
  const fake = fakeNpx(() => {
    for (const [tool, id] of [['.claude', 'new1'], ['.codex', 'new2']]) {
      mkdirSync(join(home, tool, 'skills', id), { recursive: true });
      writeFileSync(join(home, tool, 'skills', id, 'SKILL.md'), `# ${id}\n`);
    }
    writeFileSync(join(mine, 'sub', 'SKILL.md'), 'PISADO\n');
  });
  const { r, logs } = await fetchSh(t0, 'owner/repo', fake, home);
  assert.deepEqual(r.dirs.map((d) => basename(d)).sort(), ['mine', 'new1', 'new2']);
  for (const d of r.dirs) assert.ok(d.startsWith(r.cleanup), d);
  assert.equal(existsSync(join(home, '.claude', 'skills', 'new1')), false);
  assert.equal(existsSync(join(home, '.codex', 'skills', 'new2')), false);
  assert.equal(readFileSync(join(mine, 'sub', 'SKILL.md'), 'utf8'), 'MIO\n');
  assert.ok(logs.includes(t('instHomeSkillRestored', 'mine')));
});

test('skillssh: si npx falla, el error sube y no queda temporal', POSIX, async (t0) => {
  let cwd;
  const exec = (_c, _a, opts) => { cwd = opts.cwd; addLocal('foo')(cwd); throw new Error('npx murió'); };
  await assert.rejects(skillsShFetch('owner/repo', { exec, home: await tempDir(t0) }), { message: 'npx murió' });
  assert.equal(existsSync(cwd), false);
});

test('skillssh: sin nada descargado → error claro y temporal borrada', POSIX, async (t0) => {
  const fake = fakeNpx(() => {});
  await assert.rejects(skillsShFetch('owner/repo', { exec: fake.exec, home: await tempDir(t0) }), { message: t('instSkillsAddEmpty') });
  assert.equal(existsSync(fake.calls[0].opts.cwd), false);
});

// ---------- snapshot ----------
test('snapshot: una raíz por entrada (también las que no existen) con huella y respaldo recursivo', async (t0) => {
  const base = await tempDir(t0);
  const root = join(base, 'root');
  await mkdir(join(root, 'mine', 'sub'), { recursive: true });
  await writeFile(join(root, 'mine', 'sub', 'f.md'), 'x');
  assert.deepEqual(await snapshotRoots([], join(base, 'bk0')), []);
  const snaps = await snapshotRoots([root, join(base, 'nope')], join(base, 'bk'));
  assert.equal(snaps.length, 2);
  assert.equal(snaps[0].entries.get('mine'), await hashDir(join(root, 'mine')));
  assert.equal(snaps[1].entries.size, 0);
  assert.equal(readFileSync(join(base, 'bk', '0', 'mine', 'sub', 'f.md'), 'utf8'), 'x');
});

test('snapshot: huella de lo ilegible por lstat y de lo inexistente', POSIX, async (t0) => {
  const base = await tempDir(t0);
  await symlink(join(base, 'no-existe'), join(base, 'roto'));
  assert.match(await fingerprint(join(base, 'roto')), /^unreadable:\d+(\.\d+)?:\d+$/);
  assert.equal(await fingerprint(join(base, 'nada')), 'missing');
});

test('snapshot: lo intacto se queda, lo nuevo se mueve y lo cambiado se mueve y se restaura', async (t0) => {
  const base = await tempDir(t0);
  const root = join(base, 'root');
  for (const id of ['keep', 'mine']) {
    await mkdir(join(root, id, 'sub'), { recursive: true });
    await writeFile(join(root, id, 'sub', 'f.md'), `${id}\n`);
  }
  const snaps = await snapshotRoots([root], join(base, 'bk'));
  await mkdir(join(root, 'added', 'sub'), { recursive: true });
  await writeFile(join(root, 'added', 'sub', 'f.md'), 'nuevo\n');
  await writeFile(join(root, 'mine', 'sub', 'f.md'), 'pisado\n');
  const strays = join(base, 'strays');
  const { dirs, restored } = await collectChanges(snaps, strays);
  assert.deepEqual(restored, ['mine']);
  assert.deepEqual([...dirs].sort(), [join(strays, '0', 'added'), join(strays, '0', 'mine')]);
  assert.deepEqual((await readdir(root)).sort(), ['keep', 'mine']);
  assert.equal(await readFile(join(root, 'mine', 'sub', 'f.md'), 'utf8'), 'mine\n');
  assert.equal(await readFile(join(strays, '0', 'mine', 'sub', 'f.md'), 'utf8'), 'pisado\n');
  assert.equal(existsSync(join(strays, '0', 'keep')), false);
});

test('snapshot: un enlace relativo dentro de la skill restaurada sigue siendo relativo', POSIX, async (t0) => {
  const base = await tempDir(t0);
  const root = join(base, 'root');
  await mkdir(join(root, 'mine'), { recursive: true });
  await writeFile(join(root, 'mine', 'SKILL.md'), 'mio\n');
  await symlink('SKILL.md', join(root, 'mine', 'alias.md'));
  const snaps = await snapshotRoots([root], join(base, 'bk'));
  await writeFile(join(root, 'mine', 'SKILL.md'), 'pisado\n');
  await collectChanges(snaps, join(base, 'strays'));
  assert.equal(readlinkSync(join(root, 'mine', 'alias.md')), 'SKILL.md');
  assert.equal(await readFile(join(root, 'mine', 'SKILL.md'), 'utf8'), 'mio\n');
});

// ---------- swap ----------
async function oldSkill(t0) {
  const parent = await tempDir(t0);
  const dest = join(parent, 'demo');
  await mkdir(dest);
  await writeFile(join(dest, 'SKILL.md'), 'VIEJA\n');
  return { parent, dest };
}

test('swap: si el rename final falla, la versión anterior vuelve a su sitio', async (t0) => {
  const { parent, dest } = await oldSkill(t0);
  await assert.rejects(replaceDir(dest, async () => {}), { code: 'ENOENT' });
  assert.equal(readFileSync(join(dest, 'SKILL.md'), 'utf8'), 'VIEJA\n');
  assert.deepEqual(readdirSync(parent), ['demo']);
});

test('swap: si populate falla a medias, la copia preparada no queda en disco', async (t0) => {
  const { parent, dest } = await oldSkill(t0);
  const populate = async (staged) => {
    await mkdir(join(staged, 'sub'), { recursive: true });
    await writeFile(join(staged, 'sub', 'a.md'), 'x');
    throw new Error('disco lleno');
  };
  await assert.rejects(replaceDir(dest, populate), { message: 'disco lleno' });
  assert.deepEqual(readdirSync(parent), ['demo']);
  assert.equal(readFileSync(join(dest, 'SKILL.md'), 'utf8'), 'VIEJA\n');
});

test('swap: con éxito queda solo la nueva, sin respaldo', async (t0) => {
  const { parent, dest } = await oldSkill(t0);
  await replaceDir(dest, async (staged) => { await mkdir(staged); await writeFile(join(staged, 'SKILL.md'), 'NUEVA\n'); });
  assert.deepEqual(readdirSync(parent), ['demo']);
  assert.equal(readFileSync(join(dest, 'SKILL.md'), 'utf8'), 'NUEVA\n');
});
