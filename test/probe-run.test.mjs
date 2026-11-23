// Spec 041 (superficies sin interfaz), T2 — ejecutar las sondas (R1, R4, R5): contra el servicio levantado de
// verdad, con plazo, guardando el resultado con el commit probado y distinguiendo «falla» de «no se pudo ejecutar».
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { git, gitRepo, writeFiles } from './helpers/teamrepo.mjs';
import { main } from '../catalog/probe/probe.mjs';
import { localUrl, runApi, runCli } from '../catalog/probe/lib/run.mjs';
import { MESSAGES } from '../catalog/probe/lib/i18n.mjs';
import { equipForSpec } from '../lib/commands/equip.mjs';
import { LOCAL_IGNORES } from '../lib/gitignore-local.mjs';

const SPEC = 'specs/027-pagos';
const T = MESSAGES.es;

test('R5: solo direcciones locales', () => {
  for (const url of ['http://localhost:3000/x', 'http://127.0.0.1/', 'http://[::1]:8080/a']) assert.equal(localUrl(url), true, url);
  for (const url of ['https://example.com', 'http://localhost.evil.com', 'file:///etc/passwd', 'no-url', '']) assert.equal(localUrl(url), false, url);
});

test('R2: una sonda de API manda método, cabeceras y cuerpo, y compara la respuesta', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push([url, init.method, init.headers, init.body]); return { status: 201, text: async () => '{"estado":"creado"}' }; };
  const probe = { name: 'crear', method: 'POST', url: 'http://localhost/pagos', headers: { 'x-a': '1' }, body: { monto: 10 }, expect: { status: 201, json: { estado: 'creado' } } };
  assert.deepEqual(await runApi(probe, { fetchImpl }), { name: 'crear', kind: 'api', ok: true, mismatches: [] });
  assert.deepEqual(seen, [['http://localhost/pagos', 'POST', { 'content-type': 'application/json', 'x-a': '1' }, '{"monto":10}']]);
  const bad = await runApi({ ...probe, expect: { status: 200 } }, { fetchImpl });
  assert.deepEqual([bad.ok, bad.mismatches], [false, [{ what: 'status', expected: 200, actual: 201 }]]);
});

test('R5: un servicio que no contesta, o que tarda más que el plazo, es una sonda que falla, no un cuelgue', async () => {
  const down = await runApi({ name: 'x', method: 'GET', url: 'http://localhost/x', headers: {}, expect: { status: 200 } }, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.deepEqual(down.mismatches, [{ what: 'request', expected: 'response', actual: 'ECONNREFUSED' }]);
  const slow = (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const late = await runApi({ name: 'x', method: 'GET', url: 'http://localhost/x', headers: {}, expect: { status: 200 } }, { fetchImpl: slow, timeoutMs: 100 });
  assert.deepEqual(late.mismatches, [{ what: 'request', expected: 'response', actual: 'no response in 100 ms' }]);
});

test('R3: una sonda de CLI corre el comando en la carpeta, y compara salida y código', async (t) => {
  const dir = await tempDir(t, 'chalc-041-cli-');
  await writeFile(join(dir, 'hola.js'), "process.stdout.write('hola desde ' + require('path').basename(process.cwd()) + '\\n'); process.stderr.write('aviso\\n'); process.exit(3);\n");
  const ok = await runCli({ name: 'hola', command: 'node hola.js', expect: { exit: 3, stdout: 'hola desde', stderr: 'aviso' } }, { cwd: dir });
  assert.deepEqual(ok, { name: 'hola', kind: 'cli', ok: true, mismatches: [] });
  const bad = await runCli({ name: 'hola', command: 'node hola.js', expect: { exit: 0 } }, { cwd: dir });
  assert.deepEqual(bad.mismatches, [{ what: 'exit', expected: 0, actual: 3 }]);
  const missing = await runCli({ name: 'nada', command: 'node no-existe.js', expect: { exit: 0 } }, { cwd: dir });
  assert.equal(missing.ok, false);
});

test('R5: un comando que no termina vence en su plazo', async (t) => {
  const dir = await tempDir(t, 'chalc-041-cli-');
  // Se apaga solo a los 1,5 s: si el sistema no llega a matarlo no deja un proceso vivo, y en Windows libera pronto
  // la carpeta temporal (un proceso con su directorio de trabajo ahí impide borrarla: EBUSY).
  await writeFile(join(dir, 'lento.js'), 'setTimeout(function fin() { process.exit(0); }, 1500);\n');
  const out = await runCli({ name: 'lento', command: 'node lento.js', expect: { exit: 0 } }, { cwd: dir, timeoutMs: 300 });
  assert.deepEqual(out.mismatches, [{ what: 'timeout', expected: 'exit', actual: 'no exit in 300 ms' }]);
});

// ── el comando ────────────────────────────────────────────────────────────────────────────────────
async function serving(status, body) {
  const server = createServer((req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/pagos`, stop: () => { server.close(); server.closeAllConnections?.(); } };
}
async function project(t, probes, language = 'es') {
  const root = await gitRepo(await tempDir(t, 'chalc-041-run-'), { '.chalc/gate.json': JSON.stringify({ language }), '.gitignore': '.chalc/probe-out/\n', 'hola.js': "console.log('Uso: hola');\n",
    ...(probes === null ? { [`${SPEC}/spec.md`]: 'x' } : { [`${SPEC}/probes.json`]: typeof probes === 'string' ? probes : JSON.stringify(probes) }) });
  return root;
}
const run = async (root, ...args) => { const lines = []; return { code: await main({ argv: ['node', 'probe.mjs', ...args], cwd: root, write: (l) => lines.push(l) }), text: lines.join('\n') }; };

test('R1, R4: con todo cumpliendo sale con 0 y guarda el resultado con el commit probado', async (t) => {
  const api = await serving(201, '{"estado":"creado"}');
  try {
    const root = await project(t, { api: [{ name: 'crear', method: 'POST', url: api.url, body: { monto: 1 }, expect: { status: 201, json: { estado: 'creado' } } }], cli: [{ name: 'ayuda', command: 'node hola.js', expect: { exit: 0, stdout: 'Uso' } }] });
    const out = await run(root, 'run', '--spec', SPEC);
    assert.equal(out.code, 0, out.text);
    assert.ok(out.text.includes(T.clean(2)));
    const saved = JSON.parse(await readFile(join(root, '.chalc', 'probe-out', 'results.json'), 'utf8'));
    assert.deepEqual([saved.commit, saved.spec, saved.failures, saved.probes.map((p) => [p.name, p.kind, p.ok])], [git(root, 'rev-parse', 'HEAD').out, SPEC, 0, [['crear', 'api', true], ['ayuda', 'cli', true]]]);
  } finally { api.stop(); }
});

for (const lang of ['es', 'en']) {
  test(`R4 (${lang}): una sonda que falla dice cuál, qué se esperaba y qué llegó, y sale con 1`, async (t) => {
    const api = await serving(500, '{"error":"roto"}');
    try {
      const root = await project(t, { api: [{ name: 'crear', url: api.url, expect: { status: 201 } }] }, lang);
      const out = await run(root, 'run', '--spec', SPEC);
      assert.equal(out.code, 1);
      for (const piece of ['crear', 'status', '201', '500', MESSAGES[lang].failed(1, 1)]) assert.ok(out.text.includes(piece), `${piece}\n${out.text}`);
      assert.equal(JSON.parse(await readFile(join(root, '.chalc', 'probe-out', 'results.json'), 'utf8')).failures, 1);
    } finally { api.stop(); }
  });
}

test('R4: sin archivo de sondas, o mal formado, no se pudo ejecutar: sale con 2 y no deja resultado', async (t) => {
  const none = await project(t, null);
  const missing = await run(none, 'run', '--spec', SPEC);
  assert.deepEqual([missing.code, missing.text], [2, T.noProbes(SPEC)]);
  const broken = await project(t, '{ roto');
  const bad = await run(broken, 'run', '--spec', SPEC);
  assert.deepEqual([bad.code, bad.text], [2, T.malformed(SPEC, 'not-json')]);
  assert.equal(existsSync(join(broken, '.chalc', 'probe-out')), false);
});

test('R5: una URL que no es local no se sondea, salvo con --allow-remote; y sin --spec, el uso', async (t) => {
  const root = await project(t, { api: [{ name: 'fuera', url: 'https://example.invalid/x', expect: { status: 200 } }] });
  const out = await run(root, 'run', '--spec', SPEC);
  assert.deepEqual([out.code, out.text], [2, T.notLocal('https://example.invalid/x')]);
  for (const args of [['run'], [], ['inventado']]) assert.deepEqual([(await run(root, ...args)).code, (await run(root, ...args)).text], [1, T.usage]);
});

test('R1: equipar deja la herramienta, entra en la integridad y su salida queda fuera de git', async (t) => {
  const dir = await tempDir(t, 'chalc-041-emit-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  const manifest = JSON.parse(await readFile(join(dir, '.chalc', 'integrity.json'), 'utf8'));
  assert.ok('.chalc/probe.mjs' in manifest.files && '.chalc/probe/lib/expect.mjs' in manifest.files);
  assert.ok(LOCAL_IGNORES.includes('.chalc/probe-out/'));
  const ran = spawnSync(process.execPath, [join('.chalc', 'probe.mjs')], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.equal(ran.status, 1);
  assert.match(ran.stdout, /probe\.mjs run --spec/);
});
