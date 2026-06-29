import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { layerOf, extractImports, lintBoundaries } from '../lib/verify-boundaries.mjs';
import { verifyProject } from '../lib/verify.mjs';

async function tmp() { return mkdtemp(join(tmpdir(), 'chalc-verify-')); }
async function file(base, rel, content) {
  const abs = join(base, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

test('layerOf resolves the architecture layer (and feature) from a path', () => {
  assert.equal(layerOf('src/app/domain/entities/ticket.ts').layer, 'domain');
  assert.equal(layerOf('lib/data/repos/x.dart').layer, 'data');
  const f = layerOf('lib/features/tickets/widget.dart');
  assert.equal(f.layer, 'features');
  assert.equal(f.feature, 'tickets');
  assert.equal(layerOf('src/utils/x.ts').layer, null);   // no es una capa conocida
});

test('extractImports reads TS/JS and Dart imports', () => {
  assert.deepEqual(extractImports(`import { A } from '../domain/a';\nrequire('x');`, 'ts'), ['../domain/a', 'x']);
  assert.deepEqual(extractImports(`import 'package:app/data/x.dart';\nimport 'dart:async';`, 'dart'), ['package:app/data/x.dart', 'dart:async']);
});

test('lintBoundaries flags a domain file importing infrastructure', async () => {
  const base = await tmp();
  await file(base, 'src/app/domain/ticket.ts', `import { Db } from '../infrastructure/db';\nexport class Ticket {}`);
  await file(base, 'src/app/infrastructure/db.ts', `export class Db {}`);
  const v = await lintBoundaries(base);
  assert.equal(v.length, 1);
  assert.equal(v[0].from, 'domain');
  assert.equal(v[0].to, 'infrastructure');
  assert.equal(v[0].kind, 'layer');
});

test('lintBoundaries flags a feature importing another feature', async () => {
  const base = await tmp();
  await file(base, 'lib/features/tickets/page.dart', `import 'package:app/features/orders/order.dart';`);
  await file(base, 'lib/features/orders/order.dart', `class Order {}`);
  const v = await lintBoundaries(base);
  assert.equal(v.length, 1);
  assert.equal(v[0].kind, 'feature');
});

test('lintBoundaries passes a clean layered project (presentation -> application -> domain)', async () => {
  const base = await tmp();
  await file(base, 'src/app/domain/ticket.ts', `export class Ticket {}`);
  await file(base, 'src/app/application/createTicket.ts', `import { Ticket } from '../domain/ticket';`);
  await file(base, 'src/app/presentation/page.ts', `import { createTicket } from '../application/createTicket';`);
  assert.deepEqual(await lintBoundaries(base), []);
});

test('verifyProject reports missing structural artifacts', async () => {
  const base = await tmp();
  await mkdir(join(base, 'src', 'app', 'domain'), { recursive: true });   // existe pero sin README
  const res = await verifyProject(base, { expectFolders: ['src/app/domain'], target: 'claude' });
  const byKey = Object.fromEntries(res.checks.map((c) => [c.key, c.ok]));
  assert.equal(byKey.folders, true);
  assert.equal(byKey.folderDocs, false);        // falta README.md
  assert.equal(byKey.architectureDoc, false);   // falta docs/architecture.md
  assert.equal(byKey.assistant, false);         // falta CLAUDE.md
  assert.equal(res.ok, false);
});
