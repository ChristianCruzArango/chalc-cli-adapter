// Política única ante archivos ilegibles (M-06): lo que chalc escribe se respalda y se avisa; lo del
// catálogo se avisa y se omite (y doctor lo da como error); nada se descarta en silencio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRoles } from '../lib/roles.mjs';
import { loadToolTable } from '../lib/tooltable.mjs';
import { writeSides } from '../lib/sidesemit.mjs';
import { readContractLock } from '../lib/specfolder.mjs';
import { verifyCommand } from '../cli/engine/verify.mjs';
import { catalogJsonIssues } from '../lib/commands/doctorchecks.mjs';
import { loadConcepts, LEARNED_REL } from '../catalog/memory/lib/concepts.mjs';

const BROKEN = '{ roto';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-errpol-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

// Captura lo que se escribe por console.warn / console.error mientras corre `fn`.
async function capturing(fn) {
  const out = [];
  const { warn, error } = console;
  console.warn = (m) => out.push(String(m));
  console.error = (m) => out.push(String(m));
  try { return { value: await fn(), out }; } finally { Object.assign(console, { warn, error }); }
}

const copiesOf = async (dir, name) => (await readdir(dir)).filter((f) => f.startsWith(`${name}.invalid-`));

test('catálogo: un contrato de rol ilegible se omite CON aviso; una carpeta sin contrato, en silencio', () => withDir(async (dir) => {
  await mkdir(join(dir, 'bueno'));
  await writeFile(join(dir, 'bueno', 'contract.json'), JSON.stringify({ id: 'bueno', order: 1 }));
  await mkdir(join(dir, 'roto'));
  await writeFile(join(dir, 'roto', 'contract.json'), BROKEN);
  await mkdir(join(dir, 'docs'));
  const { value, out } = await capturing(() => loadRoles(dir));
  assert.deepEqual(value.map((r) => r.id), ['bueno']);
  assert.equal(out.length, 1);
  assert.match(out[0], /roto[\\/]contract\.json/);
}));

test('catálogo: un stack de la tabla de herramientas ilegible se omite CON aviso', () => withDir(async (dir) => {
  await writeFile(join(dir, 'ok.json'), JSON.stringify({ id: 'ok', priority: 1 }));
  await writeFile(join(dir, 'mal.json'), BROKEN);
  const { value, out } = await capturing(() => loadToolTable(dir));
  assert.deepEqual(value.map((s) => s.id), ['ok']);
  assert.equal(out.length, 1);
  assert.match(out[0], /mal\.json/);
}));

test('doctor: un JSON ilegible del catálogo es un error con su archivo', () => withDir(async (dir) => {
  await writeFile(join(dir, 'ok.json'), '{}');
  await writeFile(join(dir, 'mal.json'), BROKEN);
  const issues = await catalogJsonIssues('tools', [join(dir, 'ok.json'), join(dir, 'mal.json')]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, 'error');
  assert.match(issues[0].message, /mal\.json/);
}));

test('gate.json ilegible: writeSides no lo pisa, lo respalda y avisa', () => withDir(async (dir) => {
  await mkdir(join(dir, '.chalc'));
  await writeFile(join(dir, '.chalc', 'gate.json'), BROKEN);
  const { value, out } = await capturing(() => writeSides(dir, { me: 'back' }));
  assert.equal(value, '');
  assert.equal(await readFile(join(dir, '.chalc', 'gate.json'), 'utf8'), BROKEN, 'el original no se toca');
  assert.equal((await copiesOf(join(dir, '.chalc'), 'gate.json')).length, 1);
  assert.equal(out.length, 1);
}));

test('gate.json ilegible: verifyCommand cae al comando del stack, con copia y aviso', () => withDir(async (dir) => {
  await mkdir(join(dir, '.chalc'));
  await writeFile(join(dir, '.chalc', 'gate.json'), BROKEN);
  const { value, out } = await capturing(() => verifyCommand(['flutter'], { projectPath: dir }));
  assert.equal(value, 'flutter analyze');
  assert.equal((await copiesOf(join(dir, '.chalc'), 'gate.json')).length, 1);
  assert.equal(out.length, 1);
}));

test('lock del contrato ilegible: null (se regenera) con copia y aviso', () => withDir(async (dir) => {
  await mkdir(join(dir, '.chalc'));
  await writeFile(join(dir, '.chalc', 'contract.lock.json'), BROKEN);
  const { value, out } = await capturing(() => readContractLock(dir));
  assert.equal(value, null);
  assert.equal((await copiesOf(join(dir, '.chalc'), 'contract.lock.json')).length, 1);
  assert.equal(out.length, 1);
  assert.equal(await readContractLock(join(dir, 'no-existe')), null, 'ausente: null sin aviso');
}));

test('memoria emitida: un diccionario aprendido ilegible se respalda y AVISA una sola vez', () => withDir(async (dir) => {
  const file = join(dir, LEARNED_REL);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, BROKEN);
  const { value, out } = await capturing(async () => { await loadConcepts(dir); return loadConcepts(dir); });
  assert.equal(typeof value, 'object', 'sigue con el diccionario base');
  assert.equal((await copiesOf(join(file, '..'), 'concepts.json')).length, 1);
  assert.equal(out.length, 1);
  assert.match(out[0], /concepts\.json/);
}));
