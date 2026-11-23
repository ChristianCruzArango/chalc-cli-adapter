// Spec 032 (estado de equipo), T3 — el registro en disco (R1, R2, R4): solo se añade, vive en el repo principal
// aunque se escriba desde un worktree, y cada evento rehace `status.json` entero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { LEDGER_REL, STATUS_REL, appendEvent, readLedger, readStatus, teamOptions } from '../catalog/team/lib/ledger.mjs';
import { mainRoot } from '../catalog/team/lib/root.mjs';

const NOW = () => new Date('2026-11-22T10:00:00.000Z');
const at = (root, rel) => join(root, ...rel.split('/'));
const OPEN = { type: 'feature_opened', feature: 'pagos', agent: 'claude' };
const ADD = { type: 'spec_added', feature: 'pagos', spec: 'specs/027-checkout' };

test('R1: un evento válido se añade al registro con su fecha, y nada más cambia', async (t) => {
  const root = await tempDir(t, 'chalc-032-ledger-');
  assert.deepEqual(await appendEvent(root, OPEN, { now: NOW }), { ok: true, reason: '', event: { at: '2026-11-22T10:00:00.000Z', ...OPEN } });
  await appendEvent(root, ADD, { now: () => new Date('2026-11-22T10:01:00.000Z') });
  assert.deepEqual(await readLedger(root), [{ at: '2026-11-22T10:00:00.000Z', ...OPEN }, { at: '2026-11-22T10:01:00.000Z', ...ADD }]);
  assert.equal((await readFile(at(root, LEDGER_REL), 'utf8')).split('\n').filter(Boolean).length, 2);
});

test('R3: un evento que no vale no se escribe', async (t) => {
  const root = await tempDir(t, 'chalc-032-ledger-');
  assert.deepEqual(await appendEvent(root, { type: 'blocked', spec: 's' }), { ok: false, reason: 'missing:reason', event: null });
  assert.equal(existsSync(at(root, LEDGER_REL)), false);
});

test('R1: quien registra no puede fechar el evento ni colar un tipo en los datos', async (t) => {
  const root = await tempDir(t, 'chalc-032-ledger-');
  const out = await appendEvent(root, { ...OPEN, at: '1999-01-01T00:00:00.000Z' }, { now: NOW });
  assert.equal(out.event.at, '2026-11-22T10:00:00.000Z');
});

test('R4: cada evento rehace status.json entero desde el registro, sin dejar temporales', async (t) => {
  const root = await tempDir(t, 'chalc-032-ledger-');
  await appendEvent(root, OPEN, { now: NOW });
  await appendEvent(root, ADD, { now: NOW });
  const status = JSON.parse(await readFile(at(root, STATUS_REL), 'utf8'));
  assert.deepEqual(status.features.map((f) => [f.feature, f.specs.map((s) => s.state)]), [['pagos', ['draft']]]);
  assert.deepEqual(readdirSync(join(root, '.chalc', 'team')).sort(), ['ledger.jsonl', 'status.json']);
  assert.deepEqual(await readStatus(root, { now: NOW }), status);
});

test('R4: un status.json editado a mano no sobrevive: lo que vale es el registro', async (t) => {
  const root = await tempDir(t, 'chalc-032-ledger-');
  await appendEvent(root, OPEN, { now: NOW });
  await writeFile(at(root, STATUS_REL), '{"features":[{"feature":"inventada"}]}');
  await appendEvent(root, ADD, { now: NOW });
  assert.equal(JSON.parse(await readFile(at(root, STATUS_REL), 'utf8')).features[0].feature, 'pagos');
});

test('readLedger ignora líneas rotas y un registro que no existe', async (t) => {
  const root = await tempDir(t, 'chalc-032-ledger-');
  assert.deepEqual(await readLedger(root), []);
  await mkdir(join(root, '.chalc', 'team'), { recursive: true });
  await writeFile(at(root, LEDGER_REL), '{ roto\n' + JSON.stringify({ at: 'x', ...OPEN }) + '\n\n' + JSON.stringify({ type: 'inventado' }) + '\n');
  assert.deepEqual((await readLedger(root)).map((e) => e.type), ['feature_opened']);
});

test('R7: el umbral de atasco y el tope de intentos salen de .chalc/team.json, con sus valores por defecto', async (t) => {
  const root = await tempDir(t, 'chalc-032-ledger-');
  assert.deepEqual(await teamOptions(root), { stallMs: 20 * 60000, maxAttempts: 3 });
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'team.json'), JSON.stringify({ stallMinutes: 5, maxAttempts: 2 }));
  assert.deepEqual(await teamOptions(root), { stallMs: 5 * 60000, maxAttempts: 2 });
  await writeFile(join(root, '.chalc', 'team.json'), JSON.stringify({ stallMinutes: -1, maxAttempts: 'tres' }));
  assert.deepEqual(await teamOptions(root), { stallMs: 20 * 60000, maxAttempts: 3 }, 'un valor que no sirve cae al de por defecto');
});

// ── la raíz ───────────────────────────────────────────────────────────────────────────────────────

const git = (args, cwd) => spawnSync('git', ['-c', 'user.name=chalc', '-c', 'user.email=test@chalc.dev', ...args], { cwd, encoding: 'utf8' });

test('R2: --root manda; sin él y sin git, la raíz es la carpeta actual', async (t) => {
  const dir = await tempDir(t, 'chalc-032-root-');
  assert.equal(mainRoot(dir, ['status', '--root', join(dir, 'otra')]), join(dir, 'otra'));
  assert.equal(mainRoot(dir, ['status']), dir);
});

test('R2: desde un worktree, la raíz es el repo principal', async (t) => {
  const base = await tempDir(t, 'chalc-032-root-');
  const repo = join(base, 'repo');
  await mkdir(repo);
  await writeFile(join(repo, 'a.txt'), 'x');
  assert.equal(git(['init', '-q'], repo).status, 0);
  git(['add', '-A'], repo);
  assert.equal(git(['commit', '-q', '-m', 'base'], repo).status, 0);
  const wt = join(base, 'wt-027');
  assert.equal(git(['worktree', 'add', '-q', '-b', 'chalc/027', wt], repo).status, 0);
  assert.equal(realpathSync.native(mainRoot(wt, [])), realpathSync.native(repo));
  assert.equal(realpathSync.native(mainRoot(repo, [])), realpathSync.native(repo));
  // Y el evento escrito «desde» el worktree aterriza en el repo principal.
  await appendEvent(mainRoot(wt, []), OPEN, { now: NOW });
  assert.ok(existsSync(at(repo, LEDGER_REL)));
  assert.equal(existsSync(at(wt, LEDGER_REL)), false);
});
