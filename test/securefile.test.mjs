// test/securefile.test.mjs — restrictToOwner protege el archivo de la API key: en POSIX debe quedar
// 0600 (solo el dueño) y el endurecimiento es best-effort (nunca rompe el guardado de la config).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { restrictToOwner, writeSecureFileSync } from '../lib/securefile.mjs';

const posixOnly = { skip: process.platform === 'win32' ? 'permisos POSIX: en Windows aplica icacls' : false };

test('restrictToOwner deja el archivo en 0600 (solo el dueño lo lee/escribe)', posixOnly, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-secure-'));
  try {
    const file = join(dir, 'config.json');
    await writeFile(file, '{"apiKey":"secreto"}', { mode: 0o644 });   // permisos laxos de partida
    restrictToOwner(file);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('restrictToOwner es best-effort: una ruta inexistente NO lanza (no rompe el guardado)', () => {
  assert.doesNotThrow(() => restrictToOwner(join(tmpdir(), 'chalc-no-existe', 'config.json')));
});

test('restrictToOwner es idempotente: aplicarlo dos veces mantiene 0600', posixOnly, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-secure-'));
  try {
    const file = join(dir, 'config.json');
    await writeFile(file, '{}');
    restrictToOwner(file);
    restrictToOwner(file);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('writeSecureFileSync crea directorio 0700 y reemplaza el archivo con 0600', posixOnly, async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-secure-write-'));
  try {
    const file = join(root, 'privado', 'config.json');
    writeSecureFileSync(file, '{"apiKey":"uno"}\n');
    assert.equal(statSync(dirname(file)).mode & 0o777, 0o700);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    writeSecureFileSync(file, '{"apiKey":"dos"}\n');
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally { await rm(root, { recursive: true, force: true }); }
});
