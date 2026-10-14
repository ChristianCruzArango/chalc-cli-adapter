// T4 (spec 022, R3, S3) — `chalc init` ejecuta scaffolders con versión EXACTA y siempre la muestra.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANGULAR_CLI_NODE, NEST_CLI_NODE, pickCliTag, scaffoldSteps, scaffoldToolSummary } from '../lib/init.mjs';
import { t } from '../lib/i18n.mjs';

const EXACT = /^\d+\.\d+\.\d+$/;

test('T4 (spec 022, R3, S3) las tablas del CLI solo tienen versiones exactas', () => {
  for (const e of [...ANGULAR_CLI_NODE, ...NEST_CLI_NODE]) assert.match(e.tag, EXACT);
});

test('T4 (spec 022, R3, S3) sin rama de Node soportada no cae a latest sino a la versión exacta más nueva', () => {
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v16.0.0'), ANGULAR_CLI_NODE[0].tag);
  assert.equal(pickCliTag(NEST_CLI_NODE, 'v14.0.0'), NEST_CLI_NODE[0].tag);
});

test('T4 (spec 022, R3, S3) npx recibe el paquete con versión exacta', () => {
  assert.match(scaffoldSteps('angular', 'modular-feature-first', 'a')[0].args[1], /^@angular\/cli@\d+\.\d+\.\d+$/);
  assert.match(scaffoldSteps('nestjs', 'modular-feature', 'b')[0].args[1], /^@nestjs\/cli@\d+\.\d+\.\d+$/);
});

test('T4 (spec 022, R3, S3) el resumen del init siempre muestra la versión exacta que se ejecutará', () => {
  const nest = scaffoldToolSummary('nestjs', 'v22.20.0');
  assert.equal(nest.spec, `@nestjs/cli@${NEST_CLI_NODE[0].tag}`);
  assert.equal(nest.note, t('initToolPinned', '22.20.0'));
  const ng = scaffoldToolSummary('angular', 'v22.20.0');
  assert.equal(ng.spec, `@angular/cli@${ANGULAR_CLI_NODE[1].tag}`);
  assert.equal(scaffoldToolSummary('dotnet', 'v22.20.0'), null);
});
