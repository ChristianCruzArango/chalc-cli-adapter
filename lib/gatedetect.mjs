// lib/gatedetect.mjs — detección de la configuración del portón de calidad (spec 007, R2).
// Responsabilidad ÚNICA: mirar las señales REALES del repo y decir con qué comando se corren sus
// tests y con qué herramienta se mutan, con la ruta y el formato de su reporte nativo.
// Razón de cambio: el catálogo de stacks y herramientas de mutación. No ejecuta nada, no escribe nada.
//
// Regla dura (R2): lo que no se puede determinar CON CERTEZA queda vacío y marcado en `pending`.
// Un comando inventado es peor que un campo vacío: el vacío se ve y se corrige; el inventado falla
// en silencio o, peor, "aprueba". El runner de JS/TS sale del framework de test DETECTADO —
// nunca del lenguaje ni del stack (dos apps Angular pueden usar Karma, Jest o Vitest).

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectContext } from './detect.mjs';

// Umbrales por defecto del linter del portón. Se copian a .chalc/gate.json para que el usuario los
// ajuste sin tocar código (única superficie de configuración).
const LINT_DEFAULTS = { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3 };
const DEFAULT_THRESHOLD = 80;

// El script `test` que deja `npm init`: existe pero no corre nada. Tomarlo como comando de tests
// sería exactamente el tipo de falso positivo que R2 prohíbe.
const NPM_PLACEHOLDER = /no test specified/i;

// Framework de test de JS/TS → plugin de Stryker. Es una TABLA DE CONSULTA, no una regla de stack.
// El orden no implica prioridad: si encajan varios, la detección es ambigua y se deja pendiente.
const JS_FRAMEWORKS = [
  { id: 'jest', runner: 'jest-runner', deps: ['jest', 'jest-preset-angular'], files: /^jest\.config\.(js|cjs|mjs|ts|json)$/ },
  { id: 'karma', runner: 'karma-runner', deps: ['karma'], files: /^karma\.conf\.(js|ts)$/ },
  { id: 'vitest', runner: 'vitest-runner', deps: ['vitest'], files: /^vitest\.config\.(js|ts|mjs)$/ },
  { id: 'mocha', runner: 'mocha-runner', deps: ['mocha'], files: /^\.mocharc\.(js|cjs|json|yml|yaml)$/ },
  { id: 'jasmine', runner: 'jasmine-runner', deps: ['jasmine'], files: /^jasmine\.json$/ }
];

// Herramienta de mutación por stack. `report` es la ruta del reporte NATIVO que la herramienta
// escribe (lo que el portón parsea); `format` elige el parser; `install` es el comando exacto que
// el portón imprime cuando la herramienta no está (R4). Vacío = no hay herramienta estándar.
//
// `scopeFlag` acota la corrida a los archivos cambiados y solo se llena cuando el comando es UNA
// invocación: pegarle un flag a un comando compuesto (como el de mutmut, que redirige a un archivo)
// lo rompería en silencio. Vacío = se muta el proyecto entero.
// `--no-install` no es un detalle: sin él `npx` DESCARGA de internet lo que no encuentra —y el
// paquete `stryker` suelto es una versión abandonada de 2019, no `@stryker-mutator/core`—. El portón
// no instala nada, así que tampoco puede hacerlo el comando que lanza.
// `probe` es la ruta cuya existencia demuestra que la herramienta está: se comprueba ANTES de
// ejecutar, porque el código de salida no distingue "no instalada" de "corrió y falló".
const STRYKER_JS = {
  tool: 'stryker',
  command: 'npx --no-install stryker run',
  report: 'reports/mutation/mutation.json',
  format: 'elements',
  probe: 'node_modules/.bin/stryker',
  scopeFlag: '--mutate'
};

const NONE = { tool: '', command: '', report: '', format: '', install: '', probe: '', scopeFlag: '' };

// Un stack se reconoce por señales de RAÍZ (mismo criterio que detectContext) y aporta su comando de
// tests y su bloque de mutación. Gana el primero que encaja.
const STACKS = [
  {
    id: 'js',
    when: (ctx) => ctx.hasFile('package.json'),
    test: (ctx, { scripts }) => (scripts.test && !NPM_PLACEHOLDER.test(scripts.test) ? 'npm test' : ''),
    mutation: (ctx) => {
      const framework = detectJsFramework(ctx);
      if (!framework) return NONE;   // sin framework no hay runner, y Stryker sin runner no corre
      return { ...STRYKER_JS, install: `npm i -D @stryker-mutator/core @stryker-mutator/${framework.runner}` };
    }
  },
  {
    id: 'dotnet',
    when: (ctx) => ctx.glob('*.csproj') || ctx.glob('*.fsproj') || ctx.glob('*.sln'),
    test: () => 'dotnet test',
    mutation: () => ({
      tool: 'stryker-net',
      command: 'dotnet stryker',
      report: 'StrykerOutput/**/reports/mutation-report.json',
      format: 'elements',
      install: 'dotnet new tool-manifest && dotnet tool install dotnet-stryker',
      probe: '.config/dotnet-tools.json',   // el manifiesto local: si no está, la herramienta tampoco
      scopeFlag: '--mutate'
    })
  },
  {
    id: 'dart',
    when: (ctx) => ctx.hasFile('pubspec.yaml'),
    // Flutter y Dart puro comparten pubspec; el comando cambia y se decide por el contenido.
    test: (ctx, { pubspec }) => (/\bflutter\b/.test(pubspec) ? 'flutter test' : 'dart test'),
    mutation: () => NONE   // Dart no tiene herramienta de mutación estándar: queda pendiente (R4)
  },
  {
    id: 'python',
    when: (ctx) => ctx.hasFile('pyproject.toml') || ctx.hasFile('setup.cfg') || ctx.hasFile('requirements.txt'),
    test: (ctx, { python }) => (/pytest/.test(python) ? 'pytest' : ''),
    mutation: (ctx, { python }) => (/pytest/.test(python)
      ? {
        tool: 'mutmut',
        command: 'mutmut run && mutmut junitxml > reports/mutation/mutmut.xml',
        report: 'reports/mutation/mutmut.xml',
        format: 'junit',
        install: 'uv add --dev mutmut',
        scopeFlag: ''   // el comando redirige a un archivo: un flag al final iría después del `>`
      }
      : NONE)
  },
  {
    id: 'maven',
    when: (ctx) => ctx.hasFile('pom.xml'),
    test: () => 'mvn test',
    mutation: () => ({
      tool: 'pit',
      command: 'mvn org.pitest:pitest-maven:mutationCoverage',
      report: 'target/pit-reports/**/mutations.xml',
      format: 'pit',
      install: '',        // PIT es un plugin del pom, no un instalable suelto
      scopeFlag: ''       // PIT acota por clases (`-DtargetClasses`), no por rutas de archivo
    })
  },
  {
    id: 'rust',
    when: (ctx) => ctx.hasFile('Cargo.toml'),
    test: () => 'cargo test',
    mutation: () => NONE   // cargo-mutants: pendiente de parser (duda abierta de la spec)
  },
  {
    id: 'php',
    when: (ctx) => ctx.hasFile('composer.json'),
    test: () => 'vendor/bin/phpunit',
    mutation: () => NONE   // Infection: pendiente de parser (duda abierta de la spec)
  }
];

// El framework de test de un proyecto JS/TS, o null si no hay ninguno o hay VARIOS (ambiguo).
// Ambiguo se trata como "no sé": elegir uno a dedo es justo el falso positivo que R2 prohíbe.
function detectJsFramework(ctx) {
  const matches = JS_FRAMEWORKS.filter((f) =>
    f.deps.some((d) => ctx.deps[d]) || ctx.entries.some((e) => f.files.test(e)));
  return matches.length === 1 ? matches[0] : null;
}

// Lee los `scripts` del package.json (detectContext solo expone dependencias).
async function readScripts(dir) {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return {};
  try { return JSON.parse(await readFile(file, 'utf8')).scripts || {}; } catch { return {}; }
}

// Contenido concatenado de los archivos que declaran dependencias de un ecosistema, para buscar
// señales textuales (p. ej. `pytest`) sin parsear TOML ni YAML — cero dependencias.
async function readSignals(dir, names) {
  const parts = [];
  for (const name of names) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    try { parts.push(await readFile(file, 'utf8')); } catch { /* ilegible: se ignora */ }
  }
  return parts.join('\n');
}

// Claves sin resolver de una config, sea recién detectada o fusionada con las ediciones del usuario.
// Es DERIVADO: se recalcula siempre, nunca se conserva. Si el usuario llenó a mano lo que la
// detección no supo, el campo deja de estar pendiente y el portón deja de bloquear por R4.
export function pendingKeys(config = {}) {
  const pending = [];
  if (!config.test?.command) pending.push('test.command');
  if (!config.mutation?.command) pending.push('mutation.command');
  return pending;
}

// Detecta la config del portón para `projectPath`. `role` (back/front/movil) e `language` los aporta
// el llamador: no son señales del repo. Devuelve la config completa más `pending`, la lista de claves
// que quedaron vacías por falta de certeza — el portón las trata como bloqueo, no como "todo bien".
export async function detectGateConfig(projectPath, { role = '', language = '' } = {}) {
  const ctx = await detectContext(projectPath);
  const signals = {
    scripts: await readScripts(projectPath),
    pubspec: await readSignals(projectPath, ['pubspec.yaml']),
    python: await readSignals(projectPath, ['pyproject.toml', 'setup.cfg', 'requirements.txt'])
  };
  const stack = STACKS.find((s) => s.when(ctx));

  const testCommand = stack ? stack.test(ctx, signals) : '';
  const mutation = stack ? stack.mutation(ctx, signals) : NONE;

  const config = {
    stack: stack?.id || '',
    test: { command: testCommand },
    // `required: true` viaja siempre para que el knob sea visible. Ponerlo en false solo surte efecto
    // donde el portón no tiene parser para el stack (R21): en un repo medible se ignora.
    mutation: { ...mutation, threshold: DEFAULT_THRESHOLD, required: true },
    lint: { ...LINT_DEFAULTS },
    spec: { dir: 'specs' },
    role,
    language
  };
  return { ...config, pending: pendingKeys(config) };
}
