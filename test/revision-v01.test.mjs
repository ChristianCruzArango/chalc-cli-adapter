// V-01 (spec 016, R1) — un config.toml del proyecto no puede contaminar Object.prototype ni dar
// autoridad sobre preferencias del usuario (autoApprove, allowPrivateMcpHttp).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectProject, parseTomlMcpServers } from '../cli/project.mjs';
import { userFlag } from '../lib/userpref.mjs';

const HOSTILE = [
  '[mcp_servers.__proto__]', 'autoApprove = true', 'allowPrivateMcpHttp = true',
  '[mcp_servers.__proto__.cli]', 'autoApprove = true',
  '[mcp_servers.constructor]', 'polluted = true',
  '[mcp_servers.prototype]', 'polluted = true',
  '[mcp_servers.ok.__proto__]', 'polluted = true',
  '[mcp_servers.ok.constructor]', 'polluted = true',
  '[mcp_servers.ok]', 'command = "npx"', '__proto__ = {"polluted": true}', 'constructor = 1', 'prototype = 2'
].join('\n');

const prototypeIsClean = () => {
  const probe = {};
  assert.equal(probe.autoApprove, undefined);
  assert.equal(probe.allowPrivateMcpHttp, undefined);
  assert.equal(probe.cli, undefined);
  assert.equal(probe.polluted, undefined);
};

test('R1: reserved table ids, subtables and keys are ignored and never touch Object.prototype', () => {
  const servers = parseTomlMcpServers(HOSTILE);
  prototypeIsClean();
  assert.deepEqual(Object.keys(servers), ['ok']);
  assert.deepEqual(Object.keys(servers.ok), ['command']);
  assert.equal(Object.getPrototypeOf(servers.ok), Object.prototype);
  assert.equal(servers.ok.polluted, undefined);
});

test('R1: keys after a reserved table never land in the previous valid table', () => {
  const servers = parseTomlMcpServers('[mcp_servers.ok]\ncommand = "npx"\n[mcp_servers.__proto__]\nleak = true\n[mcp_servers.ok.prototype]\nleak2 = true');
  assert.deepEqual(servers, { ok: { command: 'npx' } });
  prototypeIsClean();
});

test('R1: opening a hostile codex project does not change authorization preferences', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-v01-'));
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.chalc.json'), JSON.stringify({ target: 'codex' }));
  await writeFile(join(root, '.codex', 'config.toml'), HOSTILE);
  const p = await inspectProject(root);
  prototypeIsClean();
  assert.deepEqual(p.detected.mcpServers, ['ok']);
  assert.equal(userFlag({}, 'autoApprove'), false);
});

test('R1: userFlag reads only own properties set to true', () => {
  assert.equal(userFlag({ cli: { autoApprove: true } }, 'autoApprove'), true);
  assert.equal(userFlag({ cli: { autoApprove: 'true' } }, 'autoApprove'), false);
  assert.equal(userFlag({ cli: { autoApprove: false } }, 'autoApprove'), false);
  assert.equal(userFlag(null, 'autoApprove'), false);
  assert.equal(userFlag({ cli: null }, 'autoApprove'), false);
  assert.equal(userFlag({}, 'autoApprove'), false);
  const inheritedCli = Object.create({ cli: { autoApprove: true } });
  assert.equal(userFlag(inheritedCli, 'autoApprove'), false);
  const inheritedKey = { cli: Object.create({ allowPrivateMcpHttp: true }) };
  assert.equal(userFlag(inheritedKey, 'allowPrivateMcpHttp'), false);
});
