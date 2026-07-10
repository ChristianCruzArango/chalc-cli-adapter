import test from 'node:test';
import assert from 'node:assert/strict';
import { DEV_ALLOW, TRUSTED_ALLOW, normalizeTrustProfile, resolveShellPolicy, isEvalCapableCommand, requiresExplicitApproval } from '../cli/tools/trust.mjs';

test('normalizeTrustProfile: alias seguros, dev solo para vacío/explícito, y typo → safe (fail-safe)', () => {
  assert.equal(normalizeTrustProfile('safe'), 'safe');
  assert.equal(normalizeTrustProfile('read-only'), 'safe');
  assert.equal(normalizeTrustProfile('trusted'), 'trusted');
  assert.equal(normalizeTrustProfile('full'), 'trusted');
  assert.equal(normalizeTrustProfile(''), 'dev');            // sin valor → dev (default intencional)
  assert.equal(normalizeTrustProfile('dev'), 'dev');
  assert.equal(normalizeTrustProfile('desconocido'), 'safe'); // typo → fail-safe: sin comandos, no dev
});

test('resolveShellPolicy con un perfil desconocido no concede privilegios (queda en safe)', () => {
  assert.deepEqual(resolveShellPolicy({ trust: 'saef' }), { profile: 'safe', allow: [] });
});

test('resolveShellPolicy aplica perfiles safe/dev/trusted sin romper allow custom', () => {
  assert.deepEqual(resolveShellPolicy({ trust: 'safe' }), { profile: 'safe', allow: [] });
  assert.deepEqual(resolveShellPolicy({ trust: 'dev' }), { profile: 'dev', allow: DEV_ALLOW });
  assert.deepEqual(resolveShellPolicy({ trust: 'trusted' }), { profile: 'trusted', allow: TRUSTED_ALLOW });
  assert.deepEqual(resolveShellPolicy({ trust: 'safe', allow: ['git'] }), { profile: 'safe+custom', allow: ['git'] });
});

test('trusted amplía dev pero no elimina comandos existentes', () => {
  for (const cmd of DEV_ALLOW) assert.ok(TRUSTED_ALLOW.includes(cmd), `trusted debe incluir ${cmd}`);
  assert.ok(TRUSTED_ALLOW.includes('mvn'));
  assert.ok(TRUSTED_ALLOW.includes('make'));
});

test('isEvalCapableCommand: intérpretes y runners de paquetes ejecutan código arbitrario', () => {
  // intérpretes: corren cualquier script (node x.js) — con /auto no puede aprobarlos nadie
  for (const cmd of ['node script.js', 'node --experimental-vm-modules x.mjs', 'python malicia.py', 'python3 x.py', 'ruby x.rb', 'php x.php']) {
    assert.equal(isEvalCapableCommand(cmd), true, `${cmd} debe pedir aprobación explícita`);
  }
  // runners de paquetes: npx/dlx descargan y ejecutan código REMOTO; run/exec corren scripts arbitrarios
  for (const cmd of ['npx create-cosa', 'npm run build', 'npm exec pkg', 'npm x pkg', 'pnpm dlx pkg', 'pnpm exec tsc', 'pnpm run dev', 'yarn dlx pkg', 'yarn run dev', 'bun x pkg', 'bun run dev']) {
    assert.equal(isEvalCapableCommand(cmd), true, `${cmd} debe pedir aprobación explícita`);
  }
});

test('isEvalCapableCommand: los comandos no-eval siguen siendo auto-aprobables', () => {
  // el flujo central del agente (instalar, compilar, correr los tests del propio proyecto) no gana fricción
  for (const cmd of ['git status', 'ls -la', 'npm install', 'npm test', 'npm ci', 'dotnet build', 'cargo build', 'flutter pub get', 'mkdir src', '', null]) {
    assert.equal(isEvalCapableCommand(cmd), false, `${cmd} no debe exigir aprobación explícita`);
  }
});

test('requiresExplicitApproval: solo bash con comando eval-capable rompe el /auto', () => {
  assert.equal(requiresExplicitApproval({ tool: 'bash', args: { command: 'node x.js' } }), true);
  assert.equal(requiresExplicitApproval({ tool: 'bash', args: { command: 'git status' } }), false);
  assert.equal(requiresExplicitApproval({ tool: 'write', args: { path: 'x.js' } }), false);   // write/edit siguen bajo /auto
  assert.equal(requiresExplicitApproval({ tool: 'mcp__db__drop', args: {} }), false);          // MCP lo gobierna approval.mjs
  assert.equal(requiresExplicitApproval({}), false);
  assert.equal(requiresExplicitApproval({ tool: 'bash' }), false);                             // sin comando no hay qué frenar
});
