import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeProjectProposal, architectureFolders, architectureSkills, ANGULAR_CLI_NODE, buildArchitectureDecision, dartPackageName, listStacks, MANDATORY_DESIGN_PRINCIPLES, pickCliTag, renderArchitectureDecisionMarkdown, resolveScaffoldTool, scaffoldSteps, slugifyProjectName, suggestArchitectures, verifySteps } from '../lib/init.mjs';
import { reshapeProject } from '../lib/init-scaffold.mjs';

test('init analysis detects signals and recommends a calibrated architecture', () => {
  const analysis = analyzeProjectProposal('Dashboard administrativo con usuarios, roles, permisos, formularios y consumo API');
  assert.equal(analysis.typeKey, 'dashboard');
  assert.ok(analysis.signals.includes('auth'));
  assert.ok(analysis.signals.includes('forms'));
  const suggestions = suggestArchitectures('angular', analysis);
  assert.ok(suggestions.some((item) => item.recommended));
  // dominio explícito → recomienda clean architecture (calibrado, no menú fijo)
  assert.equal(suggestArchitectures('angular', analyzeProjectProposal('reglas de negocio y dominio complejo')).find((s) => s.recommended).id, 'modular-clean-architecture');
});

test('mandatory principles always include Clean Code, SOLID and modular architecture', () => {
  assert.ok(MANDATORY_DESIGN_PRINCIPLES.some((p) => /implementaci[oó]n m[ií]nima|minimal implementation/i.test(p)));
  assert.ok(MANDATORY_DESIGN_PRINCIPLES.includes('Clean Code'));
  assert.ok(MANDATORY_DESIGN_PRINCIPLES.includes('SOLID'));
  assert.ok(MANDATORY_DESIGN_PRINCIPLES.some((p) => /modular/i.test(p)));   // 'arquitectura modular' / 'modular architecture'
});

test('init supports Angular, NestJS, .NET and Flutter stacks', () => {
  assert.deepEqual(listStacks().map((s) => s.id), ['angular', 'nestjs', 'dotnet', 'flutter']);
});

test('Flutter scaffolds with the official CLI (uses the machine SDK) and a valid Dart package name', () => {
  const fl = scaffoldSteps('flutter', 'feature-first', 'mi_app');
  assert.equal(fl.length, 1);
  assert.deepEqual(fl[0].args, ['create', 'mi_app']);   // sin @version: flutter create toma el SDK instalado
  assert.equal(fl[0].command, 'flutter');
  // nombre de paquete Dart: snake_case, empieza por letra
  assert.equal(dartPackageName('Mi App'), 'mi_app');
  assert.equal(dartPackageName('mi-app-genial'), 'mi_app_genial');
  assert.match(dartPackageName('123 app'), /^[a-z]/);
  // clean-architecture de Flutter usa capas presentation/domain/data
  assert.deepEqual(architectureFolders('flutter', 'clean-architecture'), ['lib/core', 'lib/shared', 'lib/presentation', 'lib/domain', 'lib/data']);
});

test('scaffoldSteps orchestrates the OFFICIAL scaffolder per stack/architecture', () => {
  const ng = scaffoldSteps('angular', 'modular-feature-first', 'mi-app');
  assert.equal(ng.length, 1);
  assert.equal(ng[0].args[0], '--yes');
  assert.match(ng[0].args[1], /^@angular\/cli@(latest|\d+)$/);   // versión elegida según el Node instalado
  assert.deepEqual(ng[0].args.slice(2, 4), ['new', 'mi-app']);

  const nest = scaffoldSteps('nestjs', 'modular-feature', 'mi-api');
  assert.equal(nest[0].args[0], '--yes');
  assert.match(nest[0].args[1], /^@nestjs\/cli@(latest|\d+)$/);
  assert.deepEqual(nest[0].args.slice(2, 4), ['new', 'mi-api']);

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
  assert.match(md, /Preguntas resueltas con el usuario|Questions resolved with the user/);   // frame bilingüe
  assert.match(md, /¿De dónde vienen los datos\?/);   // la Q&A del usuario es neutral al idioma
  assert.match(md, /API REST propia/);
  // sin clarifications, no aparece la sección
  assert.doesNotMatch(renderArchitectureDecisionMarkdown(buildArchitectureDecision({ stack: 'angular', proposal: 'x', architectureId: 'modular-feature-first' })), /Preguntas resueltas|Questions resolved/);
});

test('the architecture doc makes the human decision explicit', () => {
  const md = renderArchitectureDecisionMarkdown(buildArchitectureDecision({ stack: 'angular', proposal: 'dashboard', architectureId: 'modular-feature-first' }));
  assert.match(md, /Chalc (sugiere|suggests)/);
  assert.match(md, /(no es autoridad|not an authority)/);
  assert.match(md, /(decisi[oó]n del usuario|user's decision)/);
});

test('architectureSkills adds interface-design only for clean/hexagonal/enterprise (not for simple ones)', () => {
  assert.deepEqual(architectureSkills('dotnet', 'clean-architecture'), ['interface-design']);
  assert.deepEqual(architectureSkills('nestjs', 'clean-hexagonal'), ['interface-design']);
  assert.deepEqual(architectureSkills('angular', 'enterprise-modular'), ['interface-design']);
  assert.deepEqual(architectureSkills('angular', 'modular-feature-first'), []);
  assert.deepEqual(architectureSkills('dotnet', 'webapi-simple'), []);
});

test('pickCliTag picks the Angular CLI major compatible with the installed Node', () => {
  // Caso real del usuario: Node 22.20.0 < 22.22.3 que pide Angular 22 → cae a 20 (que sí soporta ^22.12).
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v22.20.0'), '20');
  // Node nuevo en la rama 22 → Angular 22.
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v22.22.3'), '22');
  // Node 24 reciente → Angular 22; Node 24 viejo → 20.
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v24.15.0'), '22');
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v24.0.0'), '20');
  // Node 20 LTS → Angular 20 (no 22).
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v20.19.0'), '20');
  // Node muy viejo y sin rama soportada → cae a 'latest' (el CLI mostrará el requerimiento).
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v16.0.0'), 'latest');
});

test('resolveScaffoldTool reports the chosen tool per stack (null for dotnet)', () => {
  assert.deepEqual(resolveScaffoldTool('angular', 'v22.20.0'), { pkg: '@angular/cli', tag: '20' });
  assert.deepEqual(resolveScaffoldTool('nestjs', 'v22.20.0'), { pkg: '@nestjs/cli', tag: 'latest' });
  assert.equal(resolveScaffoldTool('dotnet', 'v22.20.0'), null);
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
  // cada carpeta trae un README.md con su guía (no un .gitkeep vacío)
  const domainReadme = await readFile(join(projectPath, 'src', 'app', 'domain', 'README.md'), 'utf8');
  assert.match(domainReadme, /Domain/);
  assert.match(domainReadme, /docs\/architecture\.md/);   // referencia de vuelta a la decisión completa
  assert.ok(existsSync(join(projectPath, 'src', 'app', 'infrastructure', 'README.md')));
  const docs = await readFile(join(projectPath, 'docs', 'architecture.md'), 'utf8');
  assert.match(docs, /Clean Code/);
  assert.match(docs, /SOLID/);
  assert.match(docs, /Angular Modular Clean Architecture/);
  assert.match(docs, /Mapa de carpetas|Folder map/i);   // mapa de carpetas enriquecido
  assert.match(docs, /Reglas de dependencia|Dependency rules/i);   // reglas de dependencia
});

test('folder READMEs explain layer dependencies for clean architecture', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-folders-'));
  const projectPath = join(base, 'svc');
  const decision = buildArchitectureDecision({ stack: 'angular', proposal: 'dominio complejo con reglas', architectureId: 'modular-clean-architecture' });
  await reshapeProject(projectPath, decision);
  const domain = await readFile(join(projectPath, 'src', 'app', 'domain', 'README.md'), 'utf8');
  assert.match(domain, /ZERO|CERO/);   // el dominio no importa framework
  const docs = await readFile(join(projectPath, 'docs', 'architecture.md'), 'utf8');
  assert.match(docs, /presentation.*application.*domain|domain/);   // flujo hacia el dominio
});
