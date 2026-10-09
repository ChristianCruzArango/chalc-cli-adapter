// T34 (spec 016, R34) — `launchTerminals` (feature --worktree) no da por abierto Windows Terminal sin
// saberlo: espera el evento `spawn` o `error`, como el dashboard desde C-08.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { launchTerminals, wtArgs } from '../lib/terminals.mjs';
import { DICT, t } from '../lib/i18n.mjs';
import { openTerminals } from '../lib/commands/featureworktree.mjs';

const WS = [{ id: '005-login', dir: 'D:\\features\\005-login' }];
const spawnThat = (event, calls = []) => (cmd, args, opts) => {
  calls.push({ cmd, args, opts });
  const child = new EventEmitter();
  child.unref = () => {};
  setImmediate(() => child.emit(event, event === 'error' ? Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) : undefined));
  return child;
};

test('R34: a missing wt is reported as not launched', { timeout: 5000 }, async () => {
  assert.deepEqual(await launchTerminals(WS, { platform: 'win32', spawnImpl: spawnThat('error') }), { ok: false, launched: 0, reason: 'wt-missing' });
});

test('R34: a launched wt is reported once it really started', { timeout: 5000 }, async () => {
  const calls = [];
  assert.deepEqual(await launchTerminals(WS, { platform: 'win32', spawnImpl: spawnThat('spawn', calls) }), { ok: true, launched: 1 });
  assert.deepEqual(calls.map((c) => [c.cmd, c.args, c.opts.detached]), [['wt', wtArgs(WS), true]]);
});

test('R34: the worktree command waits for the launch and says so when wt is missing', { timeout: 5000 }, async () => {
  const printed = [];
  const print = (m) => printed.push(m);
  const missing = await openTerminals(WS, { launch: async () => ({ ok: false, launched: 0, reason: 'wt-missing' }), print });
  assert.equal(missing.reason, 'wt-missing');
  assert.equal(printed.length, 1);
  assert.ok(printed[0].includes(t('featNoWindowsTerminal')));
  printed.length = 0;
  const seen = [];
  await openTerminals([{ id: 'a', dir: 'D:\\a', extra: 1 }], { launch: async (ws) => { seen.push(ws); return { ok: true, launched: 1 }; }, print });
  assert.deepEqual(printed, []);
  assert.deepEqual(seen, [[{ id: 'a', dir: 'D:\\a' }]]);
  assert.notEqual(DICT.es.featNoWindowsTerminal, DICT.en.featNoWindowsTerminal);
  assert.match(DICT.en.featNoWindowsTerminal, /Windows Terminal/);
});
