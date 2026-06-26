import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeProjectProposal, architectureFolders, architectureSkills, buildArchitectureDecision, listStacks, MANDATORY_DESIGN_PRINCIPLES, renderArchitectureDecisionMarkdown, scaffoldSteps, slugifyProjectName, suggestArchitectures, verifySteps } from '../lib/init.mjs';
import { reshapeProject } from '../lib/init-scaffold.mjs';

test('init analysis detects signals and recommends a calibrated architecture', () => {
  const analysis = analyzeProjectProposal('Dashboard administrativo con usuarios, roles, permisos, formularios y consumo API');
  assert.equal(analysis.type, 'dashboard administrativo');
  assert.ok(analysis.signals.includes('auth'));
  assert.ok(analysis.signals.includes('forms'));
  const suggestions = suggestArchitectures('angular', analysis);
  assert.ok(suggestions.some((item) => item.recommended));
  // dominio explícito → recomienda clean architecture (calibrado, no menú fijo)
  assert.equal(suggestArchitectures('angular', analyzeProjectProposal('reglas de negocio y dominio complejo')).find((s) => s.recommended).id, 'modular-clean-architecture');
});

test('mandatory principles always include Clean Code, SOLID and modular architecture', () => {
  assert.ok(MANDATORY_DESIGN_PRINCIPLES.includes('Clean Code'));
  assert.ok(MANDATORY_DESIGN_PRINCIPLES.includes('SOLID'));
  assert.ok(MANDATORY_DESIGN_PRINCIPLES.includes('arquitectura modular'));
});

test('init supports Angular, NestJS and .NET stacks', () => {
  assert.deepEqual(listStacks().map((s) => s.id), ['angular', 'nestjs', 'dotnet']);
});

test('scaffoldSteps orchestrates the OFFICIAL scaffolder per stack/architecture', () => {
  const ng = scaffoldSteps('angular', 'modular-feature-first', 'mi-app');
  assert.equal(ng.length, 1);
  assert.deepEqual(ng[0].args.slice(0, 4), ['--yes', '@angular/cli@latest', 'new', 'mi-app']);

  const nest = scaffoldSteps('nestjs', 'modular-feature', 'mi-api');
  assert.deepEqual(nest[0].args.slice(0, 4), ['--yes', '@nestjs/cli@latest', 'new', 'mi-api']);

  const dnSimple = scaffoldSteps('dotnet', 'webapi-simple', 'mi-svc');
  assert.deepEqual(dnSimple[0].args, ['new', 'webapi', '-n', 'mi-svc']);
  assert.equal(dnSimple[0].cwd, 'parent');

  // .NET clean = solución + capas, varios pasos dentro del proyecto
  const dnClean = scaffoldSteps('dotnet', 'clean-architecture', 'mi-svc');
  assert.ok(dnClean.length >= 5);
  assert.ok(dnClean.every((s) => s.cwd === 'project'));
  assert.ok(dnClean.some((s) => s.args.includes('sln') && s.args.includes('add')));
});

test('the architecture doc records the clarifications the user answered', () => {
  const decision = buildArchitectureDecision({
    stack: 'angular', proposal: 'dashboard', architectureId: 'modular-feature-first',
    clarifications: [{ q: '¿De dónde vienen los datos?', a: 'API REST propia' }]
  });
  const md = renderArchitectureDecisionMarkdown(decision);
  assert.match(md, /Preguntas resueltas con el usuario/);
  assert.match(md, /¿De dónde vienen los datos\?/);
  assert.match(md, /API REST propia/);
  // sin clarifications, no aparece la sección
  assert.doesNotMatch(renderArchitectureDecisionMarkdown(buildArchitectureDecision({ stack: 'angular', proposal: 'x', architectureId: 'modular-feature-first' })), /Preguntas resueltas/);
});

test('architectureSkills adds interface-design only for clean/hexagonal/enterprise (not for simple ones)', () => {
  assert.deepEqual(architectureSkills('dotnet', 'clean-architecture'), ['interface-design']);
  assert.deepEqual(architectureSkills('nestjs', 'clean-hexagonal'), ['interface-design']);
  assert.deepEqual(architectureSkills('angular', 'enterprise-modular'), ['interface-design']);
  assert.deepEqual(architectureSkills('angular', 'modular-feature-first'), []);
  assert.deepEqual(architectureSkills('dotnet', 'webapi-simple'), []);
});

test('verifySteps build the project (install/build per stack)', () => {
  assert.deepEqual(verifySteps('angular').map((s) => s.command), ['npm', 'npm']);
  assert.deepEqual(verifySteps('dotnet').map((s) => s.command), ['dotnet', 'dotnet']);
});

test('reshapeProject creates the architecture folders and the decision doc', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-init-'));
  const projectPath = join(base, slugifyProjectName('Mi Admin App'));
  const decision = buildArchitectureDecision({ stack: 'angular', proposal: 'Dashboard empresarial con reglas de negocio, roles y API', architectureId: 'modular-clean-architecture' });

  const reshaped = await reshapeProject(projectPath, decision);
  assert.deepEqual(reshaped.folders, architectureFolders('angular', 'modular-clean-architecture'));
  assert.ok(existsSync(join(projectPath, 'src', 'app', 'domain', '.gitkeep')));
  assert.ok(existsSync(join(projectPath, 'src', 'app', 'infrastructure')));
  const docs = await readFile(join(projectPath, 'docs', 'architecture.md'), 'utf8');
  assert.match(docs, /Clean Code/);
  assert.match(docs, /SOLID/);
  assert.match(docs, /Angular Modular Clean Architecture/);
});
