// Hallazgos de gravedad baja de la auditoría (S-20 … S-34): un test de regresión por hallazgo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnlyMcpTool } from '../cli/mcp/approval.mjs';

test('S-20: the MCP tool name is everything after the server, not the last __ segment', () => {
  assert.equal(isReadOnlyMcpTool('mcp__db__drop_db__list'), false);
  assert.equal(isReadOnlyMcpTool('mcp__db__list_tables'), true);
  assert.equal(isReadOnlyMcpTool('mcp__my_srv__get_user'), true);
  assert.equal(isReadOnlyMcpTool('list'), false);
});

test('S-21: a session used without approve denies writes instead of granting them', async () => {
  const { mkdtemp, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createSession } = await import('../cli/session.mjs');
  const projectPath = await mkdtemp(join(tmpdir(), 'chalc-s21-'));
  let call = 0;
  const chatImpl = async () => (call++ === 0
    ? JSON.stringify({ thought: 'escribo', action: { tool: 'write', args: { path: 'x.txt', content: 'hola' } } })
    : JSON.stringify({ thought: 'fin', done: true, summary: 'ok' }));
  const session = await createSession({ projectPath, cfg: { provider: 'ollama', model: 'm' }, chatImpl, language: 'es' });
  const result = await session.ask('crea x.txt');
  await session.close();
  assert.match(JSON.stringify(result.steps), /not approved/);
  assert.deepEqual((await readdir(projectPath)).filter((f) => f === 'x.txt'), []);
});

test('S-22: an unknown name that only starts like a local tool is not run as that tool', async () => {
  const { runAgent } = await import('../cli/engine/loop.mjs');
  const ran = [];
  const tools = {
    edit: { summary: 'x', run: async () => { ran.push('edit'); return { ok: true }; } },
    bash: { summary: 'x', run: async () => { ran.push('bash'); return { ok: true }; } },
    'mcp__angular-cli__get_best_practices': { summary: 'x', run: async () => { ran.push('mcp'); return { ok: true }; } }
  };
  const turns = [{ action: { tool: 'editor_x', args: {} } }, { action: { tool: 'bash_y', args: {} } }, { action: { tool: 'mcp__angular-cli__get_best', args: {} } }, { done: true, summary: 'ok' }];
  let i = 0;
  await runAgent({ tools, chatImpl: async () => JSON.stringify({ thought: 't', ...turns[i++] }), renderPrompt: () => ({ system: '', user: '' }), maxSteps: 6, ccr: false });
  assert.deepEqual(ran, ['mcp']);
});

test('S-23: a detached child of the shell dies when the CLI process exits', { skip: process.platform === 'win32' }, async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtemp, writeFile, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'chalc-s23-'));
  await writeFile(join(dir, 'sleeper.mjs'), "require('node:fs').writeFileSync('pid', String(process.pid)); setInterval(() => {}, 1000);".replace("require('node:fs')", "(await import('node:fs'))"));
  const shell = fileURLToPath(new URL('../cli/tools/shell.mjs', import.meta.url));
  const script = `import { execBounded } from ${JSON.stringify(shell)};
    execBounded('node sleeper.mjs', { cwd: ${JSON.stringify(dir)}, timeoutMs: 60000 });
    setTimeout(() => process.exit(0), 800);`;
  spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dir, timeout: 15000 });
  const pid = Number(await readFile(join(dir, 'pid'), 'utf8'));
  await new Promise((r) => setTimeout(r, 200));
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  if (alive) process.kill(pid, 'SIGKILL');
  assert.equal(alive, false);
});

test('S-24: allowedPaths cannot be escaped with .. segments or a different host', async () => {
  const { httpExecutor } = await import('../lib/qaagent.mjs');
  const urls = [];
  const exec = httpExecutor('http://localhost:3000', { allowedPaths: ['/api'], fetchImpl: async (url) => { urls.push(url); return { status: 200, text: async () => '' }; } });
  for (const path of ['/api/../admin', '/api/%2e%2e/admin', '//evil.example/api', '/apiadmin']) {
    assert.match((await exec({ type: 'http', path })).error, /path not allowed/, path);
  }
  assert.equal((await exec({ type: 'http', path: '/api/users?x=1' })).ok, true);
  assert.deepEqual(urls, ['http://localhost:3000/api/users?x=1']);
});

test('S-25: IPv6 loopback is recognised and the scheme must match between loopback origins', async () => {
  const { validateLoginEndpoint } = await import('../lib/qalogin.mjs');
  assert.ok(validateLoginEndpoint('http://[::1]:3000/login', { baseUrl: 'http://localhost:4200' }));
  assert.ok(validateLoginEndpoint('http://[::1]:3000/login', { allowExternal: true }));
  assert.throws(() => validateLoginEndpoint('https://127.0.0.1:3000/login', { baseUrl: 'http://localhost:4200' }), /origen|origin/);
  assert.throws(() => validateLoginEndpoint('http://evil.example/login', { baseUrl: 'http://localhost:4200' }), /origen|origin/);
});

test('S-26: open-all scripts keep hostile folder names as plain text', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtemp, writeFile, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openAllScript, wtArgs } = await import('../lib/terminals.mjs');
  const dirName = '/w/a$(touch PWNED);b `touch PWNED2`';
  const ws = [{ id: "001-it's", dir: dirName }];
  const escaped = dirName.replace(';', '\\;');
  assert.ok(openAllScript(ws, 'win32').content.includes(`-d '${escaped}' cmd`));
  assert.ok(openAllScript(ws, 'win32').content.includes("--title '001-it''s'"));
  assert.ok(wtArgs(ws).includes(escaped));
  if (process.platform !== 'win32') {
    const dir = await mkdtemp(join(tmpdir(), 'chalc-s26-'));
    await writeFile(join(dir, 'open-all.sh'), openAllScript(ws, 'linux').content);
    const r = spawnSync('sh', ['open-all.sh'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.stdout, `001-it's  ->  ${dirName}\n`);
    assert.deepEqual((await readdir(dir)).sort(), ['open-all.sh']);
  }
});

test('S-27: on Windows, repo-derived arguments go through cmd.exe quoted, never as a shell string', async () => {
  const { windowsCommand } = await import('../lib/proc.mjs');
  const cmd = windowsCommand('dotnet', ['build', 'C:\\My Projects\\App.csproj']);
  assert.deepEqual(cmd.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(cmd.args[3], '"dotnet build "C:\\My Projects\\App.csproj""');
  for (const bad of ['a & calc', 'x|y', '%PATH%', 'a^b', 'x\ny']) assert.throws(() => windowsCommand('dotnet', [bad]), /no seguros|unsafe/);
});

test('S-28: flags cannot reach the prototype and --no-* is validated', async () => {
  const { parseArgs } = await import('../lib/args.mjs');
  assert.throws(() => parseArgs(['--no-__proto__']), /inválida|Invalid flag/);
  assert.throws(() => parseArgs(['--no-toString']), /desconocida|Unknown flag/);
  assert.throws(() => parseArgs(['--no-loquesea']), /desconocida|Unknown flag/);
  const { flags } = parseArgs(['--no-force', '--yes']);
  assert.equal(Object.getPrototypeOf(flags), null);
  assert.deepEqual({ ...flags }, { force: false, yes: true });
});

test('S-29: secrets passed as flags are accepted but flagged with their env alternative', async () => {
  const { parseArgs } = await import('../lib/args.mjs');
  const { warnings } = parseArgs(['--pat', 'x', '--token=y', '--auth-password', 'z', '--target', 'claude']);
  assert.deepEqual(warnings, [
    { flag: 'pat', env: 'CHALC_PAT' }, { flag: 'token', env: 'CHALC_TOKEN' }, { flag: 'auth-password', env: 'CHALC_QA_PASSWORD' }
  ]);
});

test('S-30: the dashboard never imports code from the workspace it scans', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { sideAdvice } = await import('../lib/dashboard.mjs');
  const dest = await mkdtemp(join(tmpdir(), 'chalc-s30-'));
  await mkdir(join(dest, '.chalc', 'next'), { recursive: true });
  await writeFile(join(dest, '.chalc', 'next', 'next.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(dest, 'PWNED'))}, 'x'); export const advise = async () => ({ action: 'done', reason: '' });`);
  await sideAdvice(dest);
  assert.equal(existsSync(join(dest, 'PWNED')), false);
});

test('S-33: a null message or non-array verdicts never crash the QA agent', async () => {
  const { parseAgentMessage, normalizeVerdicts } = await import('../lib/qaagent.mjs');
  for (const raw of ['null', '42', '[1,2]']) assert.throws(() => parseAgentMessage(raw), /objeto|JSON/);
  for (const bad of [null, 'x', { id: 'R1' }, [null, 'R1', { id: 'R1', status: 'pass' }]]) {
    const out = normalizeVerdicts(bad, ['R1', 'R2']);
    assert.equal(out.length, 2);
  }
});

test('S-34: HTML entities are decoded once, so an escaped entity stays literal', async () => {
  const { stripHtml } = await import('../lib/sources.mjs');
  assert.equal(stripHtml('<p>a &amp;lt;b&amp;gt; &lt;c&gt; &amp; d&nbsp;e</p>'), 'a &lt;b&gt; <c> & d e');
});

test('F-22: one skill failing to apply does not abort the run nor skip the lock for the others', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, symlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { updateSkills } = await import('../lib/update.mjs');
  const root = await mkdtemp(join(tmpdir(), 'chalc-f22-'));
  const catalog = join(root, 'catalog');
  const src = join(root, 'src');
  for (const id of ['buena', 'rota']) {
    await mkdir(join(catalog, 'skills', id), { recursive: true });
    await writeFile(join(catalog, 'skills', id, 'SKILL.md'), 'v1');
    await writeFile(join(catalog, 'skills', id, '.chalc-skill.json'), JSON.stringify({ id, source: join(src, id), sourceType: 'local', contentSha256: 'viejo', hashVersion: 2 }));
    await mkdir(join(src, id), { recursive: true });
    await writeFile(join(src, id, 'SKILL.md'), 'v2');
  }
  if (process.platform !== 'win32') await symlink('/etc/hosts', join(src, 'rota', 'fuera.md'));   // la copia la rechaza
  const { results, lockWritten } = await updateSkills({ catalog, chalcRoot: root });
  const byId = Object.fromEntries(results.map((r) => [r.id, r.status]));
  assert.equal(byId.buena, 'updated');
  if (process.platform !== 'win32') assert.equal(byId.rota, 'error');
  assert.equal(lockWritten, true);
  assert.match(await readFile(join(root, 'skills-lock.json'), 'utf8'), /"buena"/);
});

test('F-23: concurrent memory writes keep every count, and two notices in one second both survive', async () => {
  const { mkdtemp, readdir, writeFile, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { remember, readMemory, compactIfNeeded } = await import('../catalog/memory/lib/store.mjs');
  const { send } = await import('../catalog/mail/lib/mailbox.mjs');
  const { capture } = await import('../catalog/memory/lib/capture.mjs');

  const root = await mkdtemp(join(tmpdir(), 'chalc-f23-'));
  await Promise.all(Array.from({ length: 10 }, () => remember(root, { key: 'k', text: 'regla' })));
  assert.equal((await readMemory(root)).entries[0].seen, 10);
  await compactIfNeeded(root);
  await remember(root, { key: 'k', text: 'regla' });
  assert.equal((await readMemory(root)).entries[0].seen, 11);

  const dir = await mkdtemp(join(tmpdir(), 'chalc-f23-mail-'));
  const peers = [{ id: 'back' }, { id: 'front' }];
  const now = '2026-10-08T10:00:00Z';
  await send({ dir, from: 'back', to: 'front', message: 'uno', peers, now });
  await send({ dir, from: 'back', to: 'front', message: 'dos', peers, now });
  assert.equal((await readdir(join(dir, 'front', 'new'))).length, 2);

  await mkdir(join(root, '.chalc', 'memory'), { recursive: true });
  await writeFile(join(root, '.chalc', 'memory', 'state.json'), '{ roto');
  await assert.doesNotReject(() => capture(root));
});

test('F-24: gate exit codes per signal, no TTY for detached children, quoted advisor paths', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { commandOf } = await import('../catalog/next/lib/actions.mjs');
  const run = await readFile(fileURLToPath(new URL('../catalog/gate/lib/run.mjs', import.meta.url)), 'utf8');
  assert.match(run, /\['SIGTERM', 143\]/);
  assert.match(run, /stdio: \['ignore', 'inherit', 'inherit'\]/);
  assert.equal(commandOf('run_gate', { gatePath: '../mi lado/.chalc/gate.mjs' }), 'node "../mi lado/.chalc/gate.mjs"');
  assert.equal(commandOf('sync_contract', { facts: { minePath: 'a b.md', ownerPath: 'c.md' } }), 'git diff --no-index -- "a b.md" c.md');
});

test('F-24: mergeBase uses the remote default branch first', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { mergeBase } = await import('../catalog/gate/lib/changed.mjs');
  const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' }).trim();
  const origin = await mkdtemp(join(tmpdir(), 'chalc-f24-o-'));
  g(origin, 'init', '-q', '-b', 'trunk-principal');
  await writeFile(join(origin, 'a'), '1');
  g(origin, 'add', '.'); g(origin, 'commit', '-qm', 'base');
  const clone = await mkdtemp(join(tmpdir(), 'chalc-f24-c-'));
  g(clone, 'clone', '-q', origin, '.');
  g(clone, 'checkout', '-qb', 'feature/x');
  await writeFile(join(clone, 'b'), '2');
  g(clone, 'add', '.'); g(clone, 'commit', '-qm', 'trabajo');
  assert.equal(await mergeBase(clone), g(origin, 'rev-parse', 'HEAD'));
});

test('F-25: prices per Opus version, cache tokens counted and priced', async () => {
  const { estimateCostUSD } = await import('../lib/pricing.mjs');
  const { normalizeUsage } = await import('../lib/tokenmeter.mjs');
  const cost = (model, u) => estimateCostUSD({ provider: 'anthropic', model, ...u });
  assert.equal(cost('claude-opus-4-8', { input: 1e6 }), 5);
  assert.equal(cost('claude-opus-4-20250514', { input: 1e6 }), 15);
  assert.equal(cost('claude-opus-5-5', { output: 1e6 }), 20);
  assert.equal(cost('claude-opus-45', { input: 1e6 }), null);
  assert.equal(cost('claude-sonnet-4-6', { cacheRead: 1e6, cacheWrite: 1e6 }), 0.3 + 3.75);
  assert.equal(cost('claude-opus-5-5', { cacheRead: 1e6 }), 0.2);
  assert.deepEqual(normalizeUsage({ input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5, output_tokens: 7 }), { input: 10, output: 7, total: 112, cacheRead: 90, cacheWrite: 5 });
  assert.deepEqual(normalizeUsage({ prompt_tokens: 100, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 60 } }), { input: 40, output: 1, total: 101, cacheRead: 60, cacheWrite: 0 });
});

test('F-25: re-equipping without changes keeps .chalc.json byte-identical, and apply lands the mutation skill for the repo', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const bin = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'chalc-f25-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { jest: '29' }, scripts: { test: 'jest' } }));
  const equip = () => spawnSync(process.execPath, [bin, '--yes'], { cwd: dir, encoding: 'utf8', input: '', timeout: 60000 });
  assert.equal(equip().status, 0);
  const first = readFileSync(join(dir, '.chalc.json'), 'utf8');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(equip().status, 0);
  assert.equal(readFileSync(join(dir, '.chalc.json'), 'utf8'), first);
  const skill = join(dir, '.claude', 'skills', 'mutation-testing', 'SKILL.md');
  if (JSON.parse(first).skills.includes('mutation-testing')) assert.match(readFileSync(skill, 'utf8'), /This repo:/);
});
