import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBrowserTests, buildQaPlan, buildStartCommand, detectAuth, detectSurface, duplicateRequirementIds, environmentKey, findEnvironmentOptions, guessBaseUrls, listSpecs, probeDocker, probePlaywright, readSpecContext, requirementIds, requirements, selectEnvironment, waitForAny, waitForHttp, writeQaPlan } from '../lib/qa.mjs';

test('detectAuth flags apps that require auth and surfaces the storage keys to ask the user', async () => {
  const withAuth = await mkdtemp(join(tmpdir(), 'chalc-auth-'));
  const noAuth = await mkdtemp(join(tmpdir(), 'chalc-noauth-'));
  try {
    await mkdir(join(withAuth, 'src', 'app', 'core'), { recursive: true });
    await writeFile(join(withAuth, 'src', 'app', 'core', 'guard.ts'), "export const g = { canActivate: () => true };\nconst t = localStorage.getItem('access_token');\n");
    await writeFile(join(withAuth, 'src', 'app', 'app.routes.ts'), "export const routes = [{ path: 'login' }];\n");
    await mkdir(join(noAuth, 'src'), { recursive: true });
    await writeFile(join(noAuth, 'src', 'main.ts'), "console.log('hola');\n");

    const a = await detectAuth(withAuth);
    assert.equal(a.needsAuth, true);
    assert.ok(a.signals.includes('guards de ruta'));
    assert.deepEqual(a.storageKeys, ['access_token']);
    assert.equal(a.hasLoginRoute, true);

    assert.equal((await detectAuth(noAuth)).needsAuth, false);
  } finally {
    for (const dir of [withAuth, noAuth]) await rm(dir, { recursive: true, force: true });
  }
});

test('probePlaywright detects the @playwright/test runner via an injectable runner', async () => {
  const yes = await probePlaywright('/proj', async (cmd, args, cwd) => { assert.equal(cwd, '/proj'); return { ok: true, stdout: '1.50.0' }; });
  assert.deepEqual(yes, { available: true, version: '1.50.0', detail: '@playwright/test 1.50.0' });
  const no = await probePlaywright('/proj', async () => ({ ok: false }));
  assert.equal(no.available, false);
  assert.match(no.detail, /@playwright\/test no está instalado/);
});

test('QA lists only feature specs and reads their documented requirements', async () => {
  const project = await mkdtemp(join(tmpdir(), 'chalc-qa-'));
  try {
    await mkdir(join(project, 'specs', '_template'), { recursive: true });
    await mkdir(join(project, 'specs', '002-login'));
    await mkdir(join(project, 'specs', '010-profile'));
    await writeFile(join(project, 'specs', '002-login', 'spec.md'), '# Login\n\n- **R1** — WHEN x THE SYSTEM SHALL y.\n- **R2** — IF z THEN THE SYSTEM SHALL w.\n');
    await writeFile(join(project, 'specs', '002-login', 'plan.md'), '# Plan\n');
    await writeFile(join(project, 'specs', '010-profile', 'plan.md'), '# Incomplete\n');

    assert.deepEqual(await listSpecs(project), ['002-login']);
    const context = await readSpecContext(project, '002-login');
    assert.deepEqual(context.requirements, ['R1', 'R2']);
    assert.deepEqual(Object.keys(context.files), ['spec.md', 'plan.md']);
    assert.match(buildQaPlan(context), /\| R1 \| WHEN x THE SYSTEM SHALL y\./);
    const plan = await writeQaPlan(project, context);
    assert.equal(plan.written, true);
    assert.match(await (await import('node:fs/promises')).readFile(plan.path, 'utf8'), /Plan QA/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('QA detects declared environment entry points without reading application code', async () => {
  const project = await mkdtemp(join(tmpdir(), 'chalc-qa-env-'));
  try {
    await writeFile(join(project, 'compose.yaml'), 'services: {}\n');
    await writeFile(join(project, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', test: 'node --test' } }));
    assert.deepEqual(await findEnvironmentOptions(project), [
      { type: 'compose', label: 'Docker Compose (compose.yaml)', file: 'compose.yaml' },
      { type: 'command', label: 'npm run dev', command: 'npm run dev' }
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('QA extracts requirement id and text, normalizing case and keeping duplicates', () => {
  const spec = '# Spec\n\n- **R1** — El usuario inicia sesion.\n- **R2** Bloquea tras 3 intentos.\n- **r2** duplicado en minuscula\n';
  assert.deepEqual(requirements(spec), [
    { id: 'R1', text: 'El usuario inicia sesion.' },
    { id: 'R2', text: 'Bloquea tras 3 intentos.' },
    { id: 'R2', text: 'duplicado en minuscula' }
  ]);
  assert.deepEqual(duplicateRequirementIds(spec), ['R2']);
});

test('QA generates runnable browser tests only for observable cases and fixmes for missing data', () => {
  const context = { id: '001-login', files: { 'spec.md': '- **R1** — Login works.\n- **R2** — Shows error.\n' } };
  const code = buildBrowserTests(context, { cases: [{ id: 'R1', path: '/login', expected: 'Welcome' }] });
  assert.match(code, /page\.goto\("\/login"\)/);
  assert.match(code, /test\.fixme\('R2/);
});

test('QA plan marks the table BLOCKED when the spec declares no requirements', () => {
  const plan = buildQaPlan({ id: '003-empty', files: { 'spec.md': '# Spec\n\nSin requisitos R#.\n' } });
  assert.match(plan, /\| BLOCKED \|/);
  assert.match(plan, /No se detectaron requisitos/);
});

test('QA environment detection includes qa:up and survives an invalid package.json', async () => {
  const project = await mkdtemp(join(tmpdir(), 'chalc-qa-bad-'));
  try {
    await writeFile(join(project, 'package.json'), '{ not valid json');
    assert.deepEqual(await findEnvironmentOptions(project), []);

    await writeFile(join(project, 'package.json'), JSON.stringify({ scripts: { 'qa:up': 'docker compose up -d', start: 'node .' } }));
    assert.deepEqual(await findEnvironmentOptions(project), [
      { type: 'command', label: 'npm run qa:up', command: 'npm run qa:up' },
      { type: 'command', label: 'npm run start', command: 'npm run start' }
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('QA offers conventional adapters for non-Node projects', async () => {
  const project = await mkdtemp(join(tmpdir(), 'chalc-qa-adapter-'));
  try {
    await writeFile(join(project, 'manage.py'), '');
    await writeFile(join(project, 'go.mod'), 'module x');
    const options = await findEnvironmentOptions(project);
    assert.ok(options.some((item) => item.type === 'direct' && item.key === 'django'));
    assert.ok(options.some((item) => item.type === 'direct' && item.key === 'go'));
    assert.deepEqual(buildStartCommand(options.find((item) => item.key === 'go')), { command: 'go', args: ['run', '.'], down: null });
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('QA selects an environment by its key or label, and fails loudly on an unknown one', () => {
  const options = [
    { type: 'compose', label: 'Docker Compose (compose.yaml)', file: 'compose.yaml' },
    { type: 'command', label: 'npm run qa:up', command: 'npm run qa:up' }
  ];
  assert.equal(environmentKey(options[0]), 'compose.yaml');
  assert.equal(environmentKey(options[1]), 'qa:up');
  assert.equal(selectEnvironment(options, ''), null);
  assert.equal(selectEnvironment(options, 'qa:up'), options[1]);
  assert.equal(selectEnvironment(options, 'compose.yaml'), options[0]);
  assert.equal(selectEnvironment(options, 'npm run qa:up'), options[1]);
  assert.throws(() => selectEnvironment(options, 'nope'), /(no detectado|not detected).*compose\.yaml, qa:up/s);
});

test('QA plan records the chosen launch entry point only when one is selected', () => {
  const context = { id: '001-login', files: { 'spec.md': '- **R1** — Login.\n' } };
  assert.match(buildQaPlan(context), /\*\*Entorno de arranque:\*\* _pendiente/);
  assert.match(buildQaPlan(context, { type: 'command', command: 'npm run qa:up' }), /\*\*Entorno de arranque:\*\* `npm run qa:up` \(command\)/);
});

test('QA plan is not silently overwritten; --force (overwrite) regenerates it', async () => {
  const { readFile } = await import('node:fs/promises');
  const project = await mkdtemp(join(tmpdir(), 'chalc-qa-keep-'));
  try {
    await mkdir(join(project, 'specs', '001-login'), { recursive: true });
    await writeFile(join(project, 'specs', '001-login', 'spec.md'), '- **R1** — Login.\n');
    const context = await readSpecContext(project, '001-login');

    const first = await writeQaPlan(project, context);
    assert.equal(first.written, true);

    await writeFile(first.path, 'EDITADO A MANO\n');               // simula edición manual
    const second = await writeQaPlan(project, context);
    assert.equal(second.written, false);
    assert.match(await readFile(first.path, 'utf8'), /EDITADO A MANO/);

    const forced = await writeQaPlan(project, context, null, { overwrite: true });
    assert.equal(forced.written, true);
    assert.doesNotMatch(await readFile(first.path, 'utf8'), /EDITADO A MANO/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('QA detects the test surface from stack signals, preferring web UI over API', async () => {
  const web = await mkdtemp(join(tmpdir(), 'chalc-qa-web-'));
  const api = await mkdtemp(join(tmpdir(), 'chalc-qa-api-'));
  const both = await mkdtemp(join(tmpdir(), 'chalc-qa-both-'));
  const blank = await mkdtemp(join(tmpdir(), 'chalc-qa-blank-'));
  try {
    await writeFile(join(web, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '17' } }));
    await writeFile(join(api, 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '10', express: '4' } }));
    await writeFile(join(both, 'package.json'), JSON.stringify({ dependencies: { react: '18', fastify: '4' } }));

    const w = await detectSurface(web);
    assert.equal(w.surface, 'web');
    assert.deepEqual(w.signals.web, ['@angular/core']);

    const a = await detectSurface(api);
    assert.equal(a.surface, 'api');
    assert.deepEqual(a.signals.api, ['@nestjs/core', 'express']);

    assert.equal((await detectSurface(both)).surface, 'web');   // UI gana
    assert.equal((await detectSurface(blank)).surface, 'unknown');
  } finally {
    for (const dir of [web, api, both, blank]) await rm(dir, { recursive: true, force: true });
  }
});

test('QA detects the surface for non-Node stacks (.NET, Django, Go) from manifests and markers', async () => {
  const dotnetWeb = await mkdtemp(join(tmpdir(), 'chalc-qa-net-web-'));
  const dotnetApi = await mkdtemp(join(tmpdir(), 'chalc-qa-net-api-'));
  const django = await mkdtemp(join(tmpdir(), 'chalc-qa-dj-'));
  const go = await mkdtemp(join(tmpdir(), 'chalc-qa-go-'));
  try {
    await writeFile(join(dotnetWeb, 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.AspNetCore.Components.Web.Blazor" /></ItemGroup></Project>');
    await writeFile(join(dotnetApi, 'Api.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Swashbuckle.AspNetCore" /></ItemGroup></Project>');
    await writeFile(join(django, 'manage.py'), '#!/usr/bin/env python\n');
    await writeFile(join(go, 'go.mod'), 'module example.com/app\n\ngo 1.22\n');

    const netWeb = await detectSurface(dotnetWeb);
    assert.equal(netWeb.surface, 'web');                       // Blazor → UI
    assert.ok(netWeb.signals.web.some((s) => s.includes('blazor')));

    assert.equal((await detectSurface(dotnetApi)).surface, 'api');   // Swashbuckle, sin UI
    assert.equal((await detectSurface(django)).surface, 'web');      // manage.py → Django
    const g = await detectSurface(go);
    assert.equal(g.surface, 'api');                            // go.mod → backend HTTP por defecto
    assert.deepEqual(g.signals.api, ['go-module']);
  } finally {
    for (const dir of [dotnetWeb, dotnetApi, django, go]) await rm(dir, { recursive: true, force: true });
  }
});

test('QA guesses the dev-server URL from the stack so it need not ask the user', async () => {
  const ng = await mkdtemp(join(tmpdir(), 'chalc-url-ng-'));
  const vite = await mkdtemp(join(tmpdir(), 'chalc-url-vite-'));
  const blank = await mkdtemp(join(tmpdir(), 'chalc-url-blank-'));
  try {
    await writeFile(join(ng, 'angular.json'), '{}');
    await writeFile(join(vite, 'package.json'), JSON.stringify({ devDependencies: { vite: '5' } }));
    assert.deepEqual(await guessBaseUrls(ng), ['http://localhost:4200']);
    assert.deepEqual(await guessBaseUrls(vite), ['http://localhost:5173']);
    assert.ok((await guessBaseUrls(blank)).includes('http://localhost:3000'));   // fallback con candidatos comunes
  } finally {
    for (const dir of [ng, vite, blank]) await rm(dir, { recursive: true, force: true });
  }
});

test('waitForAny returns the first candidate URL that answers', async () => {
  const fetchImpl = async (url) => { if (url.endsWith(':4200')) return { status: 200 }; throw new Error('refused'); };
  const res = await waitForAny(['http://localhost:3000', 'http://localhost:4200'], { attempts: 2, fetchImpl, sleep: async () => {} });
  assert.deepEqual(res, { ok: true, status: 200, attempts: 1, url: 'http://localhost:4200' });

  const none = await waitForAny(['http://localhost:9'], { attempts: 2, fetchImpl: async () => { throw new Error('x'); }, sleep: async () => {} });
  assert.deepEqual(none, { ok: false, attempts: 2 });
});

test('QA derives start and teardown commands from an environment without running them', () => {
  assert.deepEqual(buildStartCommand({ type: 'command', command: 'npm run dev' }), {
    command: 'npm', args: ['run', 'dev'], down: null
  });
  assert.deepEqual(buildStartCommand({ type: 'compose', file: 'compose.yaml' }), {
    command: 'docker', args: ['compose', '--project-name', 'chalc-qa', '-f', 'compose.yaml', 'up', '-d'],
    down: { command: 'docker', args: ['compose', '--project-name', 'chalc-qa', '-f', 'compose.yaml', 'down'] }
  });
  assert.throws(() => buildStartCommand(null), /No hay entorno|No environment selected/);
  assert.throws(() => buildStartCommand({ type: 'command', command: 'make serve' }), /No sé cómo levantar|don't know how to start/);
});

test('buildStartCommand forces a known port so chalc knows the exact URL', () => {
  assert.deepEqual(buildStartCommand({ type: 'command', command: 'npm run start' }, { port: 4399 }).args, ['run', 'start', '--', '--port', '4399']);
  assert.deepEqual(buildStartCommand({ type: 'direct', command: 'ng', args: ['serve'] }, { port: 4399 }).args, ['serve', '--port', '4399']);
});

test('QA health check waits until the server answers, then reports the attempt count', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; if (calls < 3) throw new Error('ECONNREFUSED'); return { status: 200 }; };
  const ok = await waitForHttp('http://localhost:3000', { attempts: 5, fetchImpl, sleep: async () => {} });
  assert.deepEqual(ok, { ok: true, status: 200, attempts: 3 });

  const fail = await waitForHttp('http://localhost:3000', { attempts: 2, fetchImpl: async () => { throw new Error('down'); }, sleep: async () => {} });
  assert.deepEqual(fail, { ok: false, attempts: 2 });
});

test('QA reports Docker states without starting containers', async () => {
  const noDocker = await probeDocker(async () => ({ ok: false, error: 'not-found' }));
  assert.equal(noDocker.installed, false);

  const installedNoDaemon = await probeDocker(async (command, args) => {
    if (args[0] === '--version') return { ok: true, stdout: 'Docker version 28' };
    return { ok: false, error: 'daemon unavailable' };
  });
  assert.equal(installedNoDaemon.installed, true);
  assert.equal(installedNoDaemon.daemon, false);
  assert.equal(installedNoDaemon.compose, false);

  const ready = await probeDocker(async (command, args) => ({ ok: true, stdout: args[0] === 'compose' ? 'v2.38.0' : '28.0.0' }));
  assert.equal(ready.daemon, true);
  assert.equal(ready.compose, true);
  assert.deepEqual(requirementIds('- **R4** — ok\n- **r4** — duplicate'), ['R4']);
});
