// Mutation testing de la revisión técnica (spec 016) con StrykerJS. Comando: `npm run test:mutation`.
// Solo desarrollo: el runtime de chalc sigue sin dependencias. Decisión y método en
// specs/016-revision-tecnica/plan.md («Decisiones registradas»).

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gitMutateScope, mutateBase } from './test/helpers/mutatescope.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// Políticas ESTÁTICAS sobre el texto del código y del paquete (literales en throw, tamaño de funciones,
// bit de ejecución, claves i18n). En el sandbox el código está instrumentado y los permisos no se
// copian: fallarían sin que haya mutante. Siguen corriendo completas en `npm test`.
const STATIC_POLICY_TESTS = new Set([
  'revision-m03.test.mjs',
  'code-size.test.mjs',
  'package-hygiene.test.mjs',
  'revision-c05.test.mjs',
  'audit022-g3-apply.test.mjs'   // lee apply.mjs como texto (importarlo lee argv y la terminal)
]);

// Lista calculada (el glob del runner tap no admite negaciones): todo test nuevo entra solo.
const testFiles = readdirSync(new URL('./test/', import.meta.url))
  .filter((f) => f.endsWith('.test.mjs') && !STATIC_POLICY_TESTS.has(f))
  .sort()
  .map((f) => `test/${f}`);

// Se muta SOLO lo que cambió, como hace el portón: las líneas nuevas de cada hunk de `git diff -U0 <base>`
// sobre bin/ cli/ lib/ targets/ catalog/, y los archivos nuevos (sin seguimiento) enteros. Fuera: diccionarios
// i18n (tablas de texto) y los entrypoints bin/chalc.mjs y cli/index.mjs, que solo se prueban por subproceso.
// Se calcula al arrancar (spec 022, 5.5): una lista literal se congelaba en la revisión que la escribió.
// Base: `CHALC_MUTATE_BASE=<commit> npm run test:mutation`; sin ella, el merge-base con main (o HEAD~1).
const mutate = gitMutateScope(mutateBase(process.env, ROOT), ROOT);

export default {
  packageManager: 'npm',
  testRunner: 'tap',
  tap: { testFiles },
  coverageAnalysis: 'perTest',
  mutate,
  reporters: ['html', 'json', 'clear-text', 'progress'],
  jsonReporter: { fileName: 'output/mutation/mutation.json' },
  htmlReporter: { fileName: 'output/mutation/mutation.html' },
  thresholds: { high: 90, low: 80, break: 80 },
  concurrency: 6,
  timeoutMS: 30000,
  tempDirName: 'tmp/stryker',
  ignorePatterns: ['output', 'tmp']
};
