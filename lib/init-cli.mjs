// lib/init-cli.mjs — qué versión EXACTA del CLI oficial (Angular/Nest/Vite/Fastify) ejecuta `chalc init`.
// Responsabilidad ÚNICA: elegir, según el Node instalado, un paquete con versión fijada y describirlo.
//
// Los CLIs oficiales (Angular sobre todo) ABORTAN si el Node no cumple su `engines`, así que se elige
// el major más nuevo que el Node de la persona soporta. Dentro de cada major la versión va FIJADA
// (nunca `latest` ni un major suelto): `npx --yes` ejecuta código de terceros, y una versión exacta es
// la que se revisó. Subirlas es un cambio explícito, en su propio commit.

import { t } from './i18n.mjs';

// Compara dos semver numéricos ("22.20.0" vs "22.22.3"): -1, 0 o 1.
function cmpSemver(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  // Stryker disable next-line EqualityOperator: pa[3]/pb[3] dan 0-0 (no decide) y `d` nunca es 0 al comparar
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

// ¿El Node instalado cae en una rama soportada por esta versión del CLI?
// req: { byMajor: { 22: '22.22.3', 24: '24.15.0' }, gte: 26 } → cubre ^22.22.3 || ^24.15.0 || >=26.
function nodeMeets(nodeVer, req) {
  const clean = String(nodeVer).replace(/^v/, '');
  const major = Number(clean.split('.')[0]);
  if (req.gte && major >= req.gte) return true;
  const floor = req.byMajor[major];
  return floor ? cmpSemver(clean, floor) >= 0 : false;
}

// Tablas Node→versión exacta del CLI (de más nueva a más vieja). Fuente: `engines` de cada paquete en
// npm (angular.dev/reference/versions). Mantener al salir un major nuevo de Angular/Nest.
export const ANGULAR_CLI_NODE = [
  { tag: '22.2.2', req: { byMajor: { 22: '22.22.3', 24: '24.15.0' }, gte: 26 } },
  { tag: '20.3.39', req: { byMajor: { 20: '20.19.0', 22: '22.12.0' }, gte: 24 } },
  { tag: '19.2.27', req: { byMajor: { 18: '18.19.1', 20: '20.11.1' }, gte: 22 } }
];
export const NEST_CLI_NODE = [
  { tag: '11.0.24', req: { byMajor: { 20: '20.11.0' }, gte: 21 } },
  { tag: '10.4.9', req: { byMajor: { 16: '16.14.0', 18: '18.0.0' }, gte: 18 } }
];

// Elige la versión del CLI más nueva compatible con el Node dado. Si ninguna encaja, la más nueva de
// la tabla (el propio CLI mostrará su requerimiento): nunca `latest`. nodeVer es inyectable en tests.
export function pickCliTag(table, nodeVer = process.version) {
  return (table.find((e) => nodeMeets(nodeVer, e.req)) || table[0]).tag;
}
// create-vite (React, spec 025 R9): `engines` ^20.19.0 || >=22.12.0. fastify-cli (R10) no declara `engines`;
// Fastify 5, que es lo que genera, pide Node 20+. Versiones con al menos dos semanas publicadas.
// fastify-cli se queda en 7.4.1: la 8.0.3 instala TypeScript 6 y su plantilla `--lang=ts` no compila con él
// (TS5011 sin `rootDir`, `baseUrl` obsoleto en test/tsconfig.json). La 7.4.1 genera Fastify 5 con TypeScript 5.9.
export const CREATE_VITE_NODE = [
  // Stryker disable next-line ObjectLiteral,StringLiteral: con una sola versión en la tabla, pickCliTag cae en ella aunque el Node no encaje; los mínimos documentan su `engines`
  { tag: '9.2.1', req: { byMajor: { 20: '20.19.0', 22: '22.12.0' }, gte: 23 } }
];
export const FASTIFY_CLI_NODE = [
  { tag: '7.4.1', req: { byMajor: {}, gte: 20 } }
];

// Stack → paquete npm del scaffolder y su tabla de versiones. Los stacks que no salen aquí no usan npx.
const SCAFFOLD_TOOLS = {
  angular: { pkg: '@angular/cli', table: ANGULAR_CLI_NODE },
  nestjs: { pkg: '@nestjs/cli', table: NEST_CLI_NODE },
  react: { pkg: 'create-vite', table: CREATE_VITE_NODE },
  fastify: { pkg: 'fastify-cli', table: FASTIFY_CLI_NODE }
};

// Paquete con versión exacta para `npx`, p. ej. `create-vite@9.2.1`.
export function scaffoldPkg(stackId, nodeVer) {
  const tool = resolveScaffoldTool(stackId, nodeVer);
  return `${tool.pkg}@${tool.tag}`;
}
export function angularCliPkg(nodeVer) { return scaffoldPkg('angular', nodeVer); }
export function nestCliPkg(nodeVer) { return scaffoldPkg('nestjs', nodeVer); }

// Resuelve qué versión del scaffolder usará un stack (para avisar al usuario). null si no aplica (dotnet).
export function resolveScaffoldTool(stackId, nodeVer = process.version) {
  const tool = Object.hasOwn(SCAFFOLD_TOOLS, stackId) ? SCAFFOLD_TOOLS[stackId] : null;
  return tool ? { pkg: tool.pkg, tag: pickCliTag(tool.table, nodeVer) } : null;
}

// Lo que el resumen del `init` muestra SIEMPRE: el paquete exacto que se ejecutará y por qué esa versión.
export function scaffoldToolSummary(stackId, nodeVer = process.version) {
  const tool = resolveScaffoldTool(stackId, nodeVer);
  if (!tool) return null;
  return { spec: `${tool.pkg}@${tool.tag}`, note: t('initToolPinned', String(nodeVer).replace(/^v/, '')) };
}
