import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectContext, formatDetect, matchRules, ruleReasons } from '../lib/detect.mjs';

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

test('formatDetect renders supported detection keys', () => {
  assert.equal(
    formatDetect({ detect: { allFile: ['pubspec.yaml'], anyGlob: ['*.dart'] } }),
    'all files: pubspec.yaml, globs: *.dart'
  );
});
