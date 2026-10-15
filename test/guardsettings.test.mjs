// T3 (spec 023, R1, R2, R3, R16) — la fusión pura de la guarda en `.claude/settings.local.json`.
//
// `withGuard` recibe el objeto del archivo (o `{}` si no existe) y devuelve el objeto con lo que la guarda
// necesita: el hook `PreToolUse` y `git commit` / `git push` en la lista `ask` de permisos. Lo del usuario
// no se toca ni se reordena, y aplicarlo dos veces deja lo mismo que aplicarlo una. No lee ni escribe disco.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GUARD_ASK, GUARD_COMMAND, GUARD_MATCHER, withGuard, withoutGuard } from '../lib/guardsettings.mjs';
import { GUARDED_TOOLS } from '../catalog/gate/lib/guard-rules.mjs';

const GUARD_GROUP = { matcher: 'Bash|Read|Grep|Glob|NotebookRead', hooks: [{ type: 'command', command: 'node .chalc/gate/guard.mjs' }] };

test('R1, R2: from an empty file the guard adds its hook and asks before commit and push', () => {
  assert.deepEqual(withGuard({}), {
    changed: true,
    settings: {
      permissions: { ask: ['Bash(git commit *)', 'Bash(git push *)'] },
      hooks: { PreToolUse: [GUARD_GROUP] }
    }
  });
});

test('R1: the hook runs the guard that chalc emits, on the tools the guard reads', () => {
  assert.equal(GUARD_COMMAND, 'node .chalc/gate/guard.mjs');
  assert.deepEqual(GUARD_MATCHER.split('|').sort(), [...GUARDED_TOOLS].sort());
});

// Igual, carácter a carácter, al bloque que `.chalc/gate-hook.md` manda pegar: quien ya lo pegó a mano no
// recibe un segundo grupo.
test('R1: the hook group is the very one the hook document tells to paste, in both languages', async () => {
  for (const file of ['gate-hook.md', 'gate-hook.en.md']) {
    const doc = (await readFile(new URL(`../catalog/hooks/${file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    const block = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes('guard.mjs'));
    assert.deepEqual(JSON.parse(block).hooks.PreToolUse, [GUARD_GROUP], file);
    assert.deepEqual(withGuard(JSON.parse(block)).settings.hooks.PreToolUse, [GUARD_GROUP], file);
  }
});

test('R16: commit and push go to ask, never to deny', () => {
  assert.deepEqual([...GUARD_ASK], ['Bash(git commit *)', 'Bash(git push *)']);
  const { settings } = withGuard({ permissions: { deny: ['Bash(rm *)'] } });
  assert.deepEqual(settings.permissions.deny, ['Bash(rm *)']);
});

test('R3: what the user had is kept, in its order, and the guard goes after it', () => {
  const user = {
    model: 'opus',
    permissions: { allow: ['Bash(npm test)'], ask: ['Bash(npm publish *)'], defaultMode: 'default' },
    hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'lint' }] }], Stop: [] },
    env: { A: '1' }
  };
  const { settings, changed } = withGuard(user);
  assert.equal(changed, true);
  assert.deepEqual(Object.keys(settings), ['model', 'permissions', 'hooks', 'env']);
  assert.deepEqual(Object.keys(settings.permissions), ['allow', 'ask', 'defaultMode']);
  assert.deepEqual(settings.permissions.ask, ['Bash(npm publish *)', 'Bash(git commit *)', 'Bash(git push *)']);
  assert.deepEqual(settings.permissions.allow, ['Bash(npm test)']);
  assert.deepEqual(settings.hooks.PreToolUse, [user.hooks.PreToolUse[0], GUARD_GROUP]);
  assert.deepEqual(settings.hooks.Stop, []);
  assert.deepEqual(settings.env, { A: '1' });
});

test('R3: applying the guard twice leaves the same file as applying it once', () => {
  const once = withGuard({ permissions: { allow: ['Bash(ls)'] } }).settings;
  assert.deepEqual(withGuard(once), { settings: once, changed: false });
});

test('R3: only what is missing is added', () => {
  const half = { permissions: { ask: ['Bash(git push *)'] }, hooks: { PreToolUse: [GUARD_GROUP] } };
  assert.deepEqual(withGuard(half), {
    changed: true,
    settings: { permissions: { ask: ['Bash(git push *)', 'Bash(git commit *)'] }, hooks: { PreToolUse: [GUARD_GROUP] } }
  });
});

test('R3: the same command under another matcher is the user\'s, and the guard adds its own group', () => {
  const own = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node .chalc/gate/guard.mjs' }] };
  const { settings } = withGuard({ hooks: { PreToolUse: [own] } });
  assert.deepEqual(settings.hooks.PreToolUse, [own, GUARD_GROUP]);
});

test('R3: the input object is never changed', () => {
  const user = { permissions: { ask: ['Bash(x)'] }, hooks: { PreToolUse: [] } };
  const copy = structuredClone(user);
  withGuard(user);
  assert.deepEqual(user, copy);
});

test('R3: a file whose shape the guard cannot extend is not touched (null)', () => {
  for (const settings of [null, [], 'x', { permissions: [] }, { permissions: { ask: 'Bash(x)' } }, { hooks: [] }, { hooks: { PreToolUse: {} } }]) {
    assert.equal(withGuard(settings), null, JSON.stringify(settings));
  }
});

test('R3: a group with the guard matcher counts as the guard only if one of its hooks runs the guard command', () => {
  const others = [
    { matcher: GUARD_MATCHER, hooks: [{ type: 'command', command: 'node other.mjs' }] },
    { matcher: GUARD_MATCHER, hooks: [{ type: 'prompt', command: GUARD_COMMAND }] },
    { matcher: GUARD_MATCHER, hooks: [null, 'x'] },
    { matcher: GUARD_MATCHER, hooks: {} },
    'x'
  ];
  for (const group of others) {
    const { settings } = withGuard({ hooks: { PreToolUse: [group] } });
    assert.deepEqual(settings.hooks.PreToolUse, [group, GUARD_GROUP], JSON.stringify(group));
  }
});

test('R3: a guard group the user extended with more hooks is still the guard, and is not duplicated', () => {
  const extended = { matcher: GUARD_MATCHER, hooks: [{ type: 'command', command: 'lint' }, { type: 'command', command: GUARD_COMMAND }] };
  const { settings } = withGuard({ hooks: { PreToolUse: [extended] } });
  assert.deepEqual(settings.hooks.PreToolUse, [extended]);
});

// T4 (spec 023, R15) — `--no-guard`: quitar SOLO lo que añade chalc. Lo del usuario queda intacto, y un
// contenedor (lista, grupo, objeto) se borra solo si lo dejó vacío esta retirada, no si ya venía vacío.

test('R15: removing the guard from what chalc wrote leaves an empty file', () => {
  assert.deepEqual(withoutGuard(withGuard({}).settings), { settings: {}, changed: true });
});

// Límite: una lista que el usuario ya tenía VACÍA (`ask: []`) no se distingue, tras activar, de una que creó
// chalc; al quitar la guarda se borra. Por eso aquí no hay ese caso.
test('R15: removing after adding gives back what the user had', () => {
  const users = [
    { model: 'opus' },
    { permissions: { allow: ['Bash(ls)'], ask: ['Bash(npm publish *)'] } },
    { permissions: { deny: [] }, hooks: { Stop: [] } },
    { hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'lint' }] }], Stop: [] } }
  ];
  for (const user of users) {
    assert.deepEqual(withoutGuard(withGuard(user).settings).settings, user, JSON.stringify(user));
  }
});

test('R15: only the guard entries go; the user\'s rules and hooks stay in their order', () => {
  const user = {
    permissions: { ask: ['Bash(npm publish *)', 'Bash(git push *)', 'Bash(git push --tags)'], deny: ['Bash(git commit *)'] },
    hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'lint' }] }, GUARD_GROUP] }
  };
  assert.deepEqual(withoutGuard(user), {
    changed: true,
    settings: {
      permissions: { ask: ['Bash(npm publish *)', 'Bash(git push --tags)'], deny: ['Bash(git commit *)'] },
      hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'lint' }] }] }
    }
  });
});

test('R15: a guard group the user extended keeps the user\'s hook', () => {
  const lint = { type: 'command', command: 'lint' };
  const extended = { matcher: GUARD_MATCHER, hooks: [lint, { type: 'command', command: GUARD_COMMAND, timeout: 5 }] };
  assert.deepEqual(withoutGuard({ hooks: { PreToolUse: [extended] } }).settings, { hooks: { PreToolUse: [{ matcher: GUARD_MATCHER, hooks: [lint] }] } });
});

test('R15: the guard command under another matcher is the user\'s and stays', () => {
  const own = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: GUARD_COMMAND }] }] } };
  assert.deepEqual(withoutGuard(own), { settings: own, changed: false });
});

test('R15: a container emptied by the removal goes, one the user already had empty stays', () => {
  assert.deepEqual(withoutGuard({ permissions: { ask: [...GUARD_ASK], allow: [] }, hooks: { PreToolUse: [GUARD_GROUP], Stop: [] } }).settings,
    { permissions: { allow: [] }, hooks: { Stop: [] } });
  assert.deepEqual(withoutGuard({ permissions: { ask: [...GUARD_ASK] }, hooks: { PreToolUse: [], Stop: [] } }).settings,
    { hooks: { PreToolUse: [], Stop: [] } });
});

test('R15: with nothing of the guard there is nothing to change', () => {
  for (const settings of [{}, { permissions: { ask: ['Bash(x)'] } }, { hooks: { PreToolUse: [{ matcher: GUARD_MATCHER, hooks: {} }] } }]) {
    assert.deepEqual(withoutGuard(settings), { settings, changed: false }, JSON.stringify(settings));
  }
});

test('R15: the input object is never changed', () => {
  const user = withGuard({ permissions: { ask: ['Bash(x)'] } }).settings;
  const copy = structuredClone(user);
  withoutGuard(user);
  assert.deepEqual(user, copy);
});

test('R15: a file whose shape the guard cannot read is not touched (null)', () => {
  for (const settings of [null, [], { permissions: [] }, { permissions: { ask: 'x' } }, { hooks: [] }, { hooks: { PreToolUse: {} } }]) {
    assert.equal(withoutGuard(settings), null, JSON.stringify(settings));
  }
});

test('R15: any other entry of the user stays, even one that is not a group', () => {
  const user = { hooks: { PreToolUse: [null, '', GUARD_GROUP, 0] } };
  assert.deepEqual(withoutGuard(user).settings, { hooks: { PreToolUse: [null, '', 0] } });
});

test('R15: removing only the rules, or only the hook, is a change too', () => {
  assert.deepEqual(withoutGuard({ permissions: { ask: [...GUARD_ASK] } }), { settings: {}, changed: true });
  assert.deepEqual(withoutGuard({ hooks: { PreToolUse: [GUARD_GROUP] } }), { settings: {}, changed: true });
});
