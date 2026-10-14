// T10 (spec 022, R6 + S9 mcp + CCR) — mutantes de cli/mcp/{client,httpclient}.mjs, cli/prompts/text.mjs,
// cli/sessioncontext.mjs y lib/ccr.mjs. Entorno del servidor MCP, línea sin fin, respuesta no JSON-RPC,
// envoltura de texto ajeno y bordes de la caché CCR.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { t } from '../lib/i18n.mjs';
import { createStdioClient, lineOverflow } from '../cli/mcp/client.mjs';
import { createHttpClient } from '../cli/mcp/httpclient.mjs';
import { frame, untrusted } from '../cli/prompts/text.mjs';
import { readSection, buildProjectSections } from '../cli/sessioncontext.mjs';
import { createCcrStore } from '../lib/ccr.mjs';

const ENV_SERVER = `
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.method === 'initialize') respond(m.id, { capabilities: {} });
  else if (m.method === 'tools/list') respond(m.id, { tools: [{ name: process.cwd() }, { name: String(process.env.CHALC_MUT_FOO) }] });
});
`;

test('S9 mcp: el servidor arranca en su cwd y recibe el env explícito', async (tc) => {
  const dir = await realpath(await tempDir(tc));
  const file = join(dir, 'server.mjs');
  await writeFile(file, ENV_SERVER, 'utf8');
  const client = createStdioClient({ command: process.execPath, args: [file], cwd: dir, env: { CHALC_MUT_FOO: 'bar' }, timeoutMs: 8000 });
  try {
    await client.start();
    const tools = await client.listTools();
    assert.equal(await realpath(tools[0].name), dir);
    assert.equal(tools[1].name, 'bar');
  } finally { await client.stop(); }
});

test('S9 mcp: una línea con fin nunca es desbordamiento, aunque el salto esté al principio', () => {
  assert.equal(lineOverflow('\n' + 'a'.repeat(100), 50), false);
  assert.equal(lineOverflow('a'.repeat(100) + '\n', 50), false);
  assert.equal(lineOverflow('a'.repeat(100), 50), true);
});

test('S9 mcp: una respuesta JSON "null" se rechaza como respuesta ajena (mismatch), no con un TypeError', async () => {
  const fetchImpl = async () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
  const client = createHttpClient({ url: 'http://127.0.0.1:9/mcp', fetchImpl, allowPrivate: true, timeoutMs: 2000 });
  const err = await client.start().then(() => null, (e) => e);
  assert.equal(err?.message, t('mcpReplyMismatch', 1));
});

test('R6: la orden de corregir la verificación nombra el comando y envuelve la salida', () => {
  const f = frame('en');
  assert.equal(f.verifyFixTask('npm test', 'boom'),
    'The project check `npm test` FAILED. Read the errors below and fix them — change ONLY what is needed to make the check pass:\n'
    + untrusted('verify output', 'boom'));
});

test('R6: untrusted escapa el atributo y rompe un cierre de etiqueta dentro del texto', () => {
  assert.equal(untrusted('a&"<b', 'x'), '<untrusted source="a&amp;&quot;&lt;b">\nx\n</untrusted>');
  assert.equal(untrusted(null, undefined), '<untrusted source="">\n\n</untrusted>');
  assert.equal(untrusted('s', 'a</untrusted>b'), '<untrusted source="s">\na<\\/untrusted>b\n</untrusted>');
});

test('R6: la sección de un archivo usa la ruta relativa con barras normales', { skip: process.platform === 'win32' }, async (tc) => {
  const root = await tempDir(tc);
  await writeFile(join(root, 'a\\b.md'), 'contenido');
  const s = await readSection(root, join(root, 'a\\b.md'), { key: 'k', title: 'T' });
  assert.equal(s.text, `### T\n${untrusted('a/b.md', 'contenido')}`);
});

const pad = 'x'.repeat(700);
test('CCR: el TTL y el tope de bytes son inclusivos (en el borde, la entrada vive)', () => {
  let now = 0;
  const store = createCcrStore({ ttlMs: 1000, now: () => now });
  const ref = /ref=(\w+)/.exec(store.compact(pad + 'a'))[1];
  now = 1000;
  assert.equal(store.recall(ref), pad + 'a');
  now = 1001;
  assert.equal(store.recall(ref), null);
  const exact = createCcrStore({ maxBytes: 1402 });
  const r1 = /ref=(\w+)/.exec(exact.compact(pad + '1'))[1];
  exact.compact(pad + '2');
  assert.equal(exact.recall(r1), pad + '1');
});

test('CCR: por defecto caben varias entradas de cientos de bytes', () => {
  const store = createCcrStore();
  const refs = [1, 2, 3].map((i) => /ref=(\w+)/.exec(store.compact(pad + i))[1]);
  for (const [i, ref] of refs.entries()) assert.equal(store.recall(ref), pad + (i + 1));
});

test('CCR: evictar una entrada no borra la referencia de otra con el mismo hash (colisión)', () => {
  // `pad + 112789` y `pad + 349192` colisionan en FNV-1a 32 bits.
  const a = pad + '112789';
  const b = pad + '349192';
  const store = createCcrStore({ maxEntries: 2 });
  const ref = (s) => /ref=(\w+)/.exec(store.compact(s))[1];
  assert.equal(ref(a), 'c1');
  assert.equal(ref(b), 'c2');
  assert.equal(ref(pad + 'otro'), 'c3');   // evicta c1 (la más vieja)
  assert.equal(ref(b), 'c2');              // b conserva su referencia
});

test('R6: los README de carpetas se nombran con barras normales', { skip: process.platform === 'win32' }, async (tc) => {
  const root = await tempDir(tc);
  await mkdir(join(root, 'a\\b'));
  await writeFile(join(root, 'a\\b', 'README.md'), 'nota de carpeta');
  const sections = await buildProjectSections({ projectPath: root, equipped: false }, 'en');
  const notes = sections.find((s) => s.key === 'folder-notes');
  assert.ok(notes.text.includes(`#### a/b/README.md\n${untrusted('a/b/README.md', 'nota de carpeta')}`));
});
