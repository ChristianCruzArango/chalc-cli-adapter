import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectContext, formatDetect, matchRules, ruleReasons } from '../lib/detect.mjs';
import { loadJsonDir } from '../lib/commands/catalogstore.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('detectContext anchors stack signals to the project root', async () => {
  const ctx = await detectContext(resolve(ROOT, 'test/fixtures/angular'));

  assert.equal(ctx.hasFile('angular.json'), true);
  assert.equal(ctx.glob('*.ts'), false);
  assert.equal(ctx.deps['@angular/core'], undefined);
});

test('matchRules suppresses generic rules implied by a specific stack', async () => {
  const ctx = await detectContext(resolve(ROOT, 'test/fixtures/nestjs'));
  const rules = [
    { id: 'global', always: true },
    { id: 'javascript', detect: { anyFile: ['package.json'] } },
    { id: 'typescript', detect: { anyDependency: ['typescript'] } },
    { id: 'nestjs', implies: ['javascript', 'typescript'], detect: { anyDependency: ['@nestjs/core'] } }
  ];

  assert.deepEqual(matchRules(rules, ctx).map((r) => r.id), ['global', 'nestjs']);
});

test('ruleReasons explains all/any signals without matching partial all rules', async () => {
  const ctx = {
    deps: { '@angular/core': '20.0.0' },
    hasFile: (name) => name === 'angular.json',
    glob: () => false,
    globMatches: () => []
  };

  assert.deepEqual(
    ruleReasons({ detect: { allFile: ['angular.json', 'tsconfig.json'], anyDependency: ['@angular/core'] } }, ctx),
    []
  );
  assert.deepEqual(
    ruleReasons({ detect: { allFile: ['angular.json'], anyDependency: ['@angular/core'] } }, ctx),
    ['file angular.json', 'dependency @angular/core']
  );
});

// R3 (spec 003) — un repo React Native se reconoce como stack móvil con las reglas reales del CLI.
test('the real rules catalog recognizes a React Native repo (framework, not just javascript)', async () => {
  const rules = await loadJsonDir(resolve(ROOT, 'rules'));
  const ctx = await detectContext(resolve(ROOT, 'test/fixtures/react-native'));
  const matched = matchRules(rules, ctx).filter((r) => !r.always);

  const names = matched.map((r) => r.name);
  assert.ok(names.includes('React Native'), `esperaba React Native en: ${names.join(', ')}`);
  // la regla específica suprime la genérica implicada (mismo patrón que angular/nestjs)
  assert.ok(!names.includes('JavaScript'), `javascript no debe listarse aparte: ${names.join(', ')}`);
});

test('a Python service deployed with Docker on Railway gets Python, Docker and Railway rules', async () => {
  const rules = await loadJsonDir(resolve(ROOT, 'rules'));
  const ctx = await detectContext(resolve(ROOT, 'test/fixtures/python-railway'));
  const matched = matchRules(rules, ctx).filter((r) => !r.always);
  const byId = Object.fromEntries(matched.map((r) => [r.id, r]));

  assert.deepEqual(Object.keys(byId).sort(), ['docker', 'python', 'railway']);
  for (const skill of ['python-code-style', 'python-design-patterns', 'async-python-patterns', 'python-testing-patterns']) {
    assert.ok(byId.python.skills.includes(skill), `falta ${skill} en la regla python`);
  }
  assert.deepEqual(byId.docker.skills, ['docker-expert']);
  // Railway MCP puede desplegar a producción: se ofrece, nunca se instala solo.
  assert.deepEqual(byId.railway.mcp, []);
  assert.deepEqual(byId.railway.optionalMcp, ['railway']);
});

test('formatDetect renders supported detection keys', () => {
  assert.equal(
    formatDetect({ detect: { allFile: ['pubspec.yaml'], anyGlob: ['*.dart'] } }),
    'all files: pubspec.yaml, globs: *.dart'
  );
});
