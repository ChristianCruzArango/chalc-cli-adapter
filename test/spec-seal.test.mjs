// Spec 024 (coherencia), T3 — el sello de la aprobación del usuario, uno por spec (R8, R14 enmendado):
// `.chalc/seals/<carpeta>.spec.json`. El sello de una spec no vale para otra.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { parseSeal, readSeal, sealPath, writeSeal } from '../catalog/gate/lib/specseal.mjs';

const SEAL = { dir: 'specs/002-pagos', hu: 'a'.repeat(64), fingerprint: '0123456789abcdef', date: '2026-11-22T10:00:00.000Z' };

test('R14: cada spec tiene su sello en .chalc/seals/<carpeta>.spec.json', () => {
  assert.equal(sealPath('/r', 'specs/002-pagos'), join('/r', '.chalc', 'seals', '002-pagos.spec.json'));
  assert.notEqual(sealPath('/r', 'specs/002-pagos'), sealPath('/r', 'specs/003-envios'));
});

test('R14: writeSeal guarda carpeta, hash de la HU, huella, fecha y que aprobó el usuario', async (t) => {
  const root = await tempDir(t, 'chalc-024-seal-');
  const file = await writeSeal(root, SEAL);
  assert.equal(file, sealPath(root, SEAL.dir));
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ...SEAL, approvedBy: 'user' });
  assert.deepEqual(await readSeal(root, SEAL.dir), { ...SEAL, approvedBy: 'user' });
});

test('R14: sellar una spec no toca el sello de otra', async (t) => {
  const root = await tempDir(t, 'chalc-024-seal-');
  await writeSeal(root, SEAL);
  await writeSeal(root, { ...SEAL, dir: 'specs/003-envios', fingerprint: 'ffffffffffffffff' });
  assert.equal((await readSeal(root, 'specs/002-pagos')).fingerprint, SEAL.fingerprint);
  assert.equal((await readSeal(root, 'specs/003-envios')).fingerprint, 'ffffffffffffffff');
});

test('R14: sin sello, readSeal devuelve null', async (t) => {
  assert.equal(await readSeal(await tempDir(t, 'chalc-024-seal-'), 'specs/002-pagos'), null);
});

test('R14: un sello copiado desde otra carpeta no cuenta', async (t) => {
  const root = await tempDir(t, 'chalc-024-seal-');
  const file = sealPath(root, 'specs/003-envios');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ ...SEAL, approvedBy: 'user' }));
  assert.equal(await readSeal(root, 'specs/003-envios'), null);
});

test('R14: parseSeal rechaza lo que no es un sello completo y bien formado', () => {
  const ok = { ...SEAL, approvedBy: 'user' };
  assert.deepEqual(parseSeal(JSON.stringify(ok)), ok);
  for (const bad of [
    '{ roto', 'null', '[]', '"x"',
    JSON.stringify({ ...ok, approvedBy: 'assistant' }),
    JSON.stringify({ ...ok, dir: '' }), JSON.stringify({ ...ok, dir: 7 }),
    JSON.stringify({ ...ok, hu: 'corto' }), JSON.stringify({ ...ok, hu: 'g'.repeat(64) }),
    JSON.stringify({ ...ok, fingerprint: '0123' }), JSON.stringify({ ...ok, fingerprint: 'ZZZZZZZZZZZZZZZZ' }),
    JSON.stringify({ ...ok, date: 'ayer' }), JSON.stringify({ ...ok, date: '' })
  ]) assert.equal(parseSeal(bad), null, bad);
});

test('R14: parseSeal ignora campos extra y devuelve solo los del sello', () => {
  assert.deepEqual(parseSeal(JSON.stringify({ ...SEAL, approvedBy: 'user', extra: 1 })), { ...SEAL, approvedBy: 'user' });
});
