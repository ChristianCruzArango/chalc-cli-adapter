// lib/skillsource/runnabletest.mjs — qué archivo de una skill ejecutaría `node --test` (spec 025, R19).
// Son los patrones por defecto del runner de Node, con las extensiones TypeScript que Node ≥ 22 ya ejecuta:
// `*.test.*`, `*-test.*`, `*_test.*`, `test-*.*`, `test.*` y todo lo que cuelga de una carpeta `test/`.
// Una skill es documentación para el agente: esos archivos no se vendorizan, porque la suite de chalc los
// correría como propios (catalog/ no es una carpeta con punto, que el runner sí salta).

const SCRIPT = /\.(c|m)?[jt]s$/;
const TEST_NAME = /(^test|[.\-_]test)\.(c|m)?[jt]s$|^test-/;

export function isRunnableTest(relPath) {
  const segments = String(relPath).split('/');
  const name = segments.pop();
  if (!SCRIPT.test(name)) return false;
  return TEST_NAME.test(name) || segments.includes('test');
}
