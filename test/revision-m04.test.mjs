// M-04 (spec 016, R31) — cada comando se registra en UN sitio (lib/commands/verbs.mjs): alias, si
// admite --dry-run, de qué posicional sale su proyecto y cómo se carga. Antes había que tocar cuatro
// sitios (COMMANDS, DRY_RUN_COMMANDS, VERB_ALIASES y la cadena de ternarios de projectArg). Y una flag
// booleana repetida (`--dry-run --no-dry-run`) toma la ÚLTIMA: antes [true,false] contaba como true.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERBS } from '../lib/commands/verbs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE = JSON.parse(readFileSync(new URL('./fixtures/m04-context-baseline.json', import.meta.url), 'utf8'));
const PROBE = join(mkdtempSync(join(tmpdir(), 'chalc-m04-')), 'probe.mjs');
writeFileSync(PROBE, `const m = await import(${JSON.stringify(new URL('../lib/commands/context.mjs', import.meta.url).href)});
process.stdout.write(JSON.stringify({ verb: m.verb, projectArg: m.projectArg, dryRun: m.dryRun }));`);

const resolveArgs = (args) => JSON.parse(spawnSync(process.execPath, [PROBE, ...args], { encoding: 'utf8', env: { ...process.env, CHALC_LANG: 'en' } }).stdout);

test('R31: verb, project argument and dry-run resolve exactly as before the refactor (249 cases)', { timeout: 120000 }, () => {
  for (const [line, expected] of Object.entries(BASELINE)) {
    const args = line.replace(/^FLAGS ?/, '').split(' ').filter(Boolean);
    assert.deepEqual(resolveArgs(args), expected, line);
  }
});

test('R31: the registry is the single source — every verb declares aliases, dryRun, project and load', async () => {
  const seen = new Map();
  for (const [verb, entry] of Object.entries(VERBS)) {
    assert.ok(Array.isArray(entry.aliases), verb);
    assert.equal(typeof entry.dryRun, 'boolean', verb);
    assert.ok(entry.project === null || entry.project === 'spec' || Number.isInteger(entry.project), verb);
    assert.equal(typeof await entry.load(), 'function', verb);
    for (const alias of entry.aliases) {
      assert.equal(seen.get(alias), undefined, `alias duplicado: ${alias}`);
      seen.set(alias, verb);
    }
  }
  assert.ok(VERBS.apply);
});

test('R31: bin/chalc.mjs and context.mjs no longer keep their own command tables', () => {
  const bin = readFileSync(join(ROOT, 'bin/chalc.mjs'), 'utf8');
  const ctx = readFileSync(join(ROOT, 'lib/commands/context.mjs'), 'utf8');
  assert.doesNotMatch(bin, /const COMMANDS = \{|DRY_RUN_COMMANDS/);
  assert.doesNotMatch(ctx, /const VERB_ALIASES = \{|verb === 'install' \? positional\[2\]/);
});

test('R31: end to end, dispatch behaves as before (help, unknown flag, dry-run refused/accepted)', { timeout: 60000 }, () => {
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'bin/chalc.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, CHALC_LANG: 'en' }, input: '' });
  assert.equal(run('--help').status, 0);
  assert.equal(run('--no-such-flag').status, 2);
  for (const verb of ['feature', 'lang', 'update']) {
    const r = run(verb, '--dry-run');
    assert.equal(r.status, 2, verb);
    assert.match(r.stderr, new RegExp(`--dry-run is not available for "${verb}"`));
  }
  assert.equal(run('tokens', '--dry-run', '--json').status, 0);
});
