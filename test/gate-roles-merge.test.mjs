// F-16 — un repo equipado antes de que existiera un rol lo recibe en el ciclo al volver a equipar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitGate, mergeRoles } from '../lib/gateemit.mjs';

const CATALOG = [
  { id: 'seguridad', order: 5, cadence: 'task', required: true, checklist: 'owasp' },
  { id: 'revisor', order: 10, cadence: 'task', required: true }
];

test('new catalog roles are added, the user tweaks are kept, custom roles survive', () => {
  const merged = mergeRoles(CATALOG, [
    { id: 'revisor', order: 10, cadence: 'feature', required: false },
    { id: 'mi-rol', order: 50, cadence: 'task', required: true }
  ]);
  assert.deepEqual(merged.map((r) => r.id), ['seguridad', 'revisor', 'mi-rol']);
  assert.equal(merged.find((r) => r.id === 'revisor').required, false);
  assert.equal(merged.find((r) => r.id === 'revisor').cadence, 'feature');
  assert.equal(merged.find((r) => r.id === 'seguridad').checklist, 'owasp');
});

test('re-equipping an old repo puts seguridad in the cycle and says so', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-f16-'));
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({
    test: { command: 'npm test' },
    flow: { roles: [{ id: 'revisor', order: 10, cadence: 'task', required: true }] }
  }));
  const { addedRoles } = await emitGate(root);
  const config = JSON.parse(await readFile(join(root, '.chalc', 'gate.json'), 'utf8'));
  assert.ok(config.flow.roles.some((r) => r.id === 'seguridad'));
  assert.ok(addedRoles.includes('seguridad'));
  assert.equal(config.test.command, 'npm test');
});
