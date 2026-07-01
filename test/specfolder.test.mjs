import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  folderSlug, nextNumber, findBySlug, resolveFeatureFolder, sharedNumber,
  contractFingerprint, contractStamp, stampFiles, readContractLock, writeContractLock
} from '../lib/specfolder.mjs';

async function tmpSpecs(dirs = []) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-specfolder-'));
  const specsDir = join(root, 'specs');
  for (const d of dirs) await mkdir(join(specsDir, d), { recursive: true });
  return specsDir;
}

test('folderSlug extrae el slug de NNN-slug y descarta lo que no matchea', () => {
  assert.equal(folderSlug('005-crear-vigencia'), 'crear-vigencia');
  assert.equal(folderSlug('011-crear-vigencia'), 'crear-vigencia');
  assert.equal(folderSlug('_template'), null);
  assert.equal(folderSlug('constitution.md'), null);
});

test('nextNumber = max+1 a 3 dígitos; 001 si no existe el directorio', async () => {
  assert.equal(await nextNumber(join(tmpdir(), 'no-existe-jamas-chalc')), '001');
  const specsDir = await tmpSpecs(['007-a', '008-b', '011-c', '_template']);
  assert.equal(await nextNumber(specsDir), '012');
});

test('findBySlug ubica la carpeta existente por slug (idempotencia)', async () => {
  const specsDir = await tmpSpecs(['005-crear-vigencia', '006-otra']);
  assert.equal(await findBySlug(specsDir, 'crear-vigencia'), '005-crear-vigencia');
  assert.equal(await findBySlug(specsDir, 'inexistente'), null);
});

test('resolveFeatureFolder REÚSA la carpeta del slug en vez de crear un duplicado NNN+1', async () => {
  const specsDir = await tmpSpecs(['005-crear-vigencia', '006-otra']);
  const r = await resolveFeatureFolder(specsDir, 'crear-vigencia');
  assert.deepEqual(r, { name: '005-crear-vigencia', reused: true });
});

test('resolveFeatureFolder crea nueva con el número forzado cuando el slug no existe', async () => {
  const specsDir = await tmpSpecs(['005-crear-vigencia']);
  assert.deepEqual(await resolveFeatureFolder(specsDir, 'nueva', '020'), { name: '020-nueva', reused: false });
  // sin preferredNum → siguiente natural
  assert.deepEqual(await resolveFeatureFolder(specsDir, 'nueva'), { name: '006-nueva', reused: false });
});

test('sharedNumber alinea repos: el mayor de los siguientes de cada uno', async () => {
  const front = await tmpSpecs(['005-x']);          // siguiente = 006
  const back = await tmpSpecs(['011-x']);           // siguiente = 012
  assert.equal(await sharedNumber([front, back]), '012');
});

test('contractFingerprint es estable e cambia con el contenido', () => {
  const a = contractFingerprint('contrato v1');
  assert.equal(a, contractFingerprint('contrato v1'));
  assert.notEqual(a, contractFingerprint('contrato v2'));
  assert.equal(a.length, 12);
});

test('contractStamp/stampFiles anteponen un comentario HTML invisible con la huella', () => {
  const stamp = contractStamp('abc123', '2026-07-01T00:00:00Z');
  assert.match(stamp, /^<!-- chalc:contract fingerprint=abc123 generated=2026-07-01T00:00:00Z -->$/);
  const out = stampFiles({ 'spec.md': '# Spec' }, stamp);
  assert.ok(out['spec.md'].startsWith(stamp + '\n'));
  assert.ok(out['spec.md'].includes('# Spec'));
});

test('read/writeContractLock hace round-trip y readContractLock devuelve null si no hay lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-lock-'));
  assert.equal(await readContractLock(root), null);
  await writeContractLock(root, { slug: 'crear-vigencia', contractHash: 'abc123', role: 'front' });
  const back = await readContractLock(root);
  assert.equal(back.contractHash, 'abc123');
  assert.equal(back.role, 'front');
  // se persiste dentro de .chalc/
  const raw = await readFile(join(root, '.chalc', 'contract.lock.json'), 'utf8');
  assert.match(raw, /contractHash/);
});
