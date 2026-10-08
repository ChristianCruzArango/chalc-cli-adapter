// catalog/gate/lib/dirs.mjs — qué carpetas no recorre el portón. Antes cada etapa llevaba su lista y
// habían divergido sin que nadie lo decidiera; ahora la base es una y cada etapa dice qué añade y por qué.

// Nunca son del proyecto: dependencias instaladas, entornos virtuales, git y el propio chalc.
export const VENDORED_DIRS = ['.git', 'node_modules', '.chalc', '.venv', 'venv'];

// Salida de build de los stacks soportados: generada, no escrita por nadie.
export const BUILD_DIRS = ['dist', 'build', 'out', 'target', 'obj', 'bin', '.next', '.nuxt', '.angular', '.dart_tool', '.gradle', 'coverage'];

// Para leer CÓDIGO (fronteras, contrato): ni dependencias ni salida de build.
export const CODE_SKIP_DIRS = new Set([...VENDORED_DIRS, ...BUILD_DIRS]);

// Para buscar el REPORTE de una herramienta: hay que entrar justo en parte de la salida de build
// (PIT deja el suyo en `target/pit-reports`, Stryker en `reports/`), así que solo se salta lo que
// nunca contiene un reporte del proyecto.
export const REPORT_SKIP_DIRS = new Set([...VENDORED_DIRS, 'dist', 'build', 'obj', 'bin']);
