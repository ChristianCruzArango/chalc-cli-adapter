// mutation.mjs — etapa de mutación del portón (R3, R4, R5). Responsabilidad ÚNICA: correr la
// herramienta configurada, leer su reporte NATIVO y decidir si la etapa pasa. Razón de cambio: las
// condiciones bajo las que una corrida de mutación es creíble.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Regla que sostiene toda la spec: lo que no se puede comprobar se BLOQUEA. Herramienta ausente,
// reporte que no está, reporte de otra versión del código o reporte ilegible terminan en código
// distinto de cero, nunca en "aprobado". Un score solo vale si salió de un archivo que la herramienta
// acaba de escribir sobre el código que se está revisando.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseElements } from './report-elements.mjs';
import { parseJUnit } from './report-junit.mjs';
import { parsePit } from './report-pit.mjs';
import { parseMutmutStats } from './report-mutmut.mjs';
import { runCommand, shellArg, UnsafeArgError } from './run.mjs';
import { rangesOf, relativeTo, touchesChange } from './hunks.mjs';
import { RULES } from './rules.mjs';
import { SOURCE_FILE, isTestFile } from './sources.mjs';
import { mtimeOf, newestSource, resolveReport } from './report-find.mjs';
import { caracteresDeLineas } from './textspan.mjs';
import { manifestOf, projectDirOf } from './projects.mjs';

const PARSERS = { elements: parseElements, junit: parseJUnit, pit: parsePit, 'mutmut-stats': parseMutmutStats };

// Los formatos que el portón sabe leer DE VERDAD. Se exportan porque son la única respuesta honesta
// a "¿puede el portón verificar este stack?" (spec 011, R7): antes esa lista estaba escrita a mano
// en la prosa de la skill `mutation-testing`, y añadir un parser obligaba a acordarse de tacharla
// allí. Ahora se cruza con el `format` que declara la tabla de herramientas.
export const FORMATS = Object.keys(PARSERS);

// Códigos de "no encontré el ejecutable": 127 en sh, 9009 en cmd.exe. Se distinguen del resto porque
// significan "no corriste nada", no "corrió y salió mal".
const NOT_INSTALLED = new Set([127, 9009]);


// Lo único que una herramienta de mutación sabe mutar. El listado de cambios trae además specs,
// documentación, colecciones de API y carpetas: colarlos en el flag de alcance no acota nada y sí
// puede dejar la corrida sin un solo archivo válido. Los tests tampoco entran: un test mutado no lo
// mata nadie, porque el test ES lo que mata mutantes.
// Son las mismas extensiones que el resto del portón reconoce como fuente.
const MUTABLE = SOURCE_FILE;

const esCodigoMutable = (file) => MUTABLE.test(file) && !isTestFile(file);

// Spec 018 (R1, R2): el manifiesto del ÚNICO proyecto al que pertenece el código de producción
// cambiado, o '' si es más de uno o ninguno. Stryker.NET solo admite un `--project`, y sin él corre
// en modo solución: compila y ejecuta la suite de todos los proyectos aunque los mutantes estén en uno.
async function proyectoUnicoDe(root, changed) {
  const manifiestos = new Set();
  for (const rel of changed.filter(esCodigoMutable)) {
    const proyecto = await manifestOf(root, rel);
    manifiestos.add(proyecto ? `${proyecto.dir}/${proyecto.file}` : '');
  }
  const [unico] = manifiestos;
  return manifiestos.size === 1 ? unico.split('/').pop() : '';
}

// Tope del alcance en caracteres. Holgado respecto al límite real de la línea de comandos (~32k en
// Windows) porque el comando lleva además la herramienta, sus flags y el flag de alcance repetido.
const MAX_SCOPE_CHARS = 16000;

// Cómo escribe cada herramienta un tramo de líneas detrás de la ruta. Stryker.NET lo lee en
// posiciones de carácter (spec 017), así que su escritura necesita el texto del archivo; StrykerJS
// lo lee en líneas.
const SPANS = {
  braces: {
    leeTexto: true,
    escribir: (glob, from, to, texto) => {
      const [inicio, fin] = caracteresDeLineas(texto, from, to);
      return `${glob}{${inicio}..${fin}}`;
    }
  },
  colon: { leeTexto: false, escribir: (glob, from, to) => `${glob}:${from}-${to}` }
};

// El texto del archivo, o `null` si no se puede leer.
async function textoDe(abs) {
  try { return await readFile(abs, 'utf8'); } catch { return null; }
}

// Traduce los archivos cambiados a los globos que espera el flag de alcance.
//
// En un repo de un solo proyecto la ruta del repo ya sirve y se deja igual. En una solución
// multiproyecto no: la herramienta resuelve los globos contra CADA proyecto, así que
// `src/Tienda.Dominio/Precios/Total.cs` no casa con nada y la corrida acaba sin mutantes —un fallo
// que se lee como "el código no se puede medir" cuando lo que falla es la ruta. Se emite entonces
// la ruta relativa al proyecto, precedida de `**/` para que case desde donde la herramienta mire.
//
// Y cuando se sabe QUÉ líneas escribió la tarea, el globo lleva además el tramo. Mutar el archivo
// entero no solo mete ruido en el veredicto: cuesta el tiempo de probar cada mutante del código que
// nadie tocó, que es de dónde salían las corridas de media hora.
async function scopeOf(root, changed, { lines = null, span = '' } = {}) {
  const sintaxis = SPANS[span];
  const enteros = [];
  const acotados = [];

  for (const rel of changed.filter(esCodigoMutable)) {
    const dir = await projectDirOf(root, rel);
    const glob = dir ? `**/${rel.slice(dir.length + 1)}` : rel;
    enteros.push(glob);

    // Los tramos que la tarea escribió, cuando se sabe cuáles son y la herramienta sabe leerlos.
    // Sin una de las dos cosas se muta el archivo entero: medir de MÁS es el lado seguro —un
    // archivo nuevo no sale en ningún diff y hay que mutarlo completo—, mientras que inventarle una
    // sintaxis de tramo a una herramienta que no la entiende la deja sin mutantes, y eso se lee
    // como "este código no se puede medir".
    const rangos = sintaxis ? rangesOf(lines?.get(rel)) : [];
    if (!rangos.length) { acotados.push(glob); continue; }

    // Un archivo que no se puede leer no tiene posiciones que calcular: se muta entero (spec 017, R3).
    const texto = sintaxis.leeTexto ? await textoDe(join(root, rel)) : '';
    if (texto === null) { acotados.push(glob); continue; }

    for (const [from, to] of rangos) acotados.push(sintaxis.escribir(glob, from, to, texto));
  }

  // Un tramo por cada trozo suelto puede hacer crecer el comando más de lo que admite la línea de
  // comandos del sistema (~32k en Windows). Pasado el tope se vuelve a los archivos enteros: se
  // mide de más, que es el lado seguro, en vez de fallar con un error del sistema operativo que no
  // dice nada del código.
  return acotados.join(' ').length > MAX_SCOPE_CHARS ? enteros : acotados;
}

// ── atribución ────────────────────────────────────────────────────────────────────────────────

// El archivo del alcance al que corresponde la ruta de un mutante, o null si no es de la tarea. Las
// herramientas no hablan el idioma de git: Stryker.NET da rutas absolutas, y PIT da la del paquete
// (`com/acme/X.java`) mientras git da `src/main/java/com/acme/X.java` — se casa por sufijo.
function taskFileOf(root, changed, file) {
  const rel = relativeTo(root, file);
  return changed.find((c) => c === rel || c.endsWith(`/${rel}`)) ?? null;
}

// ¿Cuenta este mutante para la tarea? Solo si vive en un archivo del alcance y, cuando se saben las
// líneas escritas, en una de ellas. Antes, un archivo sin mapa de líneas aceptaba TODO: con PIT o
// mutmut corriendo sin acotar, el score era el del proyecto entero.
function withinTask(root, changed, lines) {
  if (!changed.length) return null;
  return (file, line) => {
    const own = taskFileOf(root, changed, file);
    if (!own) return false;
    return lines && lines.size ? touchesChange(lines, own, line) : true;
  };
}

// ── etapa ─────────────────────────────────────────────────────────────────────────────────────

// Los bloqueos no señalan una línea de código: señalan que la corrida no se pudo creer. El `data`
// lleva lo que hace falta para redactarlo en cualquier idioma (marco bilingüe en `i18n.mjs`).
const finding = (rule, data = {}) => ({ file: '', line: 0, rule, data });

// La forma común del resultado de la etapa y la de un bloqueo.
const BASE = {
  stage: 'mutation', ok: false, blocked: false, reason: '',
  command: '', code: null, ms: 0, score: null, survivors: [], findings: []
};
const blocked = (reason, data, over = {}) =>
  ({ ...BASE, ...over, ok: false, blocked: true, reason, findings: [finding(reason, data)] });
const notInstalled = (cfg, over) => blocked(RULES.notInstalled, { tool: cfg.tool || cfg.command, install: cfg.install || '' }, over);

// Lo que se decide ANTES de ejecutar nada: el resultado de la etapa si ya está decidida, o null.
function precheck(cfg, root) {
  // Excepción declarada (R21): un stack sin herramienta que el portón sepa verificar —Dart/Flutter no
  // tiene ninguna estándar— puede declararse no aplicable en la config. Solo vale DONDE NO HAY PARSER:
  // es una salida para lo imposible, no un interruptor para apagar la mutación donde sí se puede medir.
  if (!PARSERS[cfg.format] && cfg.required === false) return { ...BASE, ok: true, skipped: true, reason: 'not-required' };
  if (!cfg.command) return blocked(RULES.noTool, {});
  // La herramienta, ANTES de ejecutar nada. `npx` descarga lo que no encuentra, así que lanzar el
  // comando a ciegas se traería un paquete de internet a mitad del portón (violando el "no instalar
  // nada") y encima daría un código de salida indistinguible de un fallo normal.
  if (cfg.probe && !existsSync(join(root, cfg.probe))) return notInstalled(cfg);
  return null;
}

// El comando acotado a lo cambiado: { command } o { result } con el bloqueo.
//
// Acotar solo si la herramienta lo admite en UNA invocación. `scopeFlag` vacío = comando tal cual:
// pegarle un flag a un comando compuesto lo rompería en silencio. `scopeJoin: 'repeat'` para las herramientas que no admiten lista:
// Stryker.NET lee una cadena con comas como UN solo globo, que no casa con nada.
async function scopedCommand(cfg, { root, changed, lines, platform }) {
  const scope = cfg.scopeFlag && changed.length ? await scopeOf(root, changed, { lines, span: cfg.scopeSpan }) : [];
  if (!scope.length) return { command: cfg.command };
  // Las rutas salen de git: son DATOS y van escapadas, nunca pegadas al comando tal cual.
  try {
    const scoped = cfg.scopeJoin === 'repeat'
      ? scope.map((g) => `${cfg.scopeFlag} ${shellArg(g, platform)}`).join(' ')
      : `${cfg.scopeFlag} ${shellArg(scope.join(','), platform)}`;
    // Spec 018: con un solo proyecto tocado, Stryker.NET corre solo ese (`projectFlag`).
    const proyecto = cfg.projectFlag ? await proyectoUnicoDe(root, changed) : '';
    const conProyecto = proyecto ? ` ${cfg.projectFlag} ${shellArg(proyecto, platform)}` : '';
    return { command: `${cfg.command} ${scoped}${conProyecto}` };
  } catch (err) {
    if (!(err instanceof UnsafeArgError)) throw err;
    return { result: blocked(RULES.unsafePath, { path: err.message }) };
  }
}

// Corre la herramienta y localiza su reporte: { ran, reportPath } o { result } con el bloqueo.
//
// El reporte tiene que salir de ESTA corrida. Comparar solo contra los fuentes dejaba aceptar el de
// una corrida anterior cuando la herramienta abortaba sin escribir. Se anota cuál había antes: si
// después es el mismo archivo y no se reescribió, no lo produjo esta corrida.
async function runAndLocate(cfg, command, { root, changed, run }) {
  const previous = await resolveReport(root, cfg.report);
  const previousMs = previous ? await mtimeOf(previous) : null;
  const { code, ms } = await run(command, { cwd: root });
  const ran = { command, code, ms };
  if (NOT_INSTALLED.has(code)) return { result: notInstalled(cfg, ran) };

  const reportPath = await resolveReport(root, cfg.report);
  // Un código ≠ 0 sin reporte suele ser la herramienta abortando: se pasa al mensaje, porque es la
  // pista de por qué no hay archivo que leer.
  if (!reportPath) return { result: blocked(RULES.noReport, { report: cfg.report, code: code === 0 ? 0 : code }, ran) };

  const source = await newestSource(root, changed);
  const reportMs = await mtimeOf(reportPath);
  const untouched = reportPath === previous && reportMs <= previousMs;
  if ((source && reportMs < source.ms) || untouched) {
    return { result: blocked(RULES.staleReport, { source: source ? source.rel : cfg.report, command: cfg.command }, ran) };
  }
  return { ran, reportPath };
}

// Lee el reporte NATIVO: { report } o { result } con el bloqueo. El alcance por LÍNEA: un mutante que
// vive en código que la tarea no escribió no dice nada sobre las pruebas que se escribieron hoy.
async function readReport(cfg, reportPath, ran, { root, changed, lines }) {
  const parse = PARSERS[cfg.format];
  if (!parse) return { result: blocked(RULES.badReport, { format: cfg.format }, ran) };
  try {
    const report = parse(await readFile(reportPath, 'utf8'), { within: withinTask(root, changed, lines) });
    return report.score === null ? { result: blocked(RULES.noMutants, {}, ran) } : { report };
  } catch (err) {
    // Un problema conocido del reporte viaja como código y el informe lo redacta en el idioma del
    // proyecto; cualquier otro error, con su mensaje tal cual.
    return { result: blocked(RULES.badReport, err?.problem ? { problem: err.problem } : { detail: err.message }, ran) };
  }
}

// Hubo medición: el veredicto lo da el score, no un bloqueo.
function verdict(report, ran, threshold) {
  const ok = report.score >= threshold;
  const findings = ok ? [] : report.survivors.length
    ? report.survivors.map((s) => ({ file: s.file, line: s.line, rule: RULES.mutantSurvived, data: { status: s.status, mutator: s.mutator, score: report.score, threshold } }))
    // Reporte agregado (mutmut 3): sin ubicaciones, un hallazgo con la cuenta de supervivientes.
    : [{ file: '', line: 0, rule: RULES.mutantSurvived, data: { status: `${report.survived + report.noCoverage} Survived`, mutator: '', score: report.score, threshold } }];
  // `threshold` va en el resultado: el informe muestra contra qué se midió.
  return { ...BASE, ...ran, ok, score: report.score, threshold, killed: report.killed + report.timeout, survivors: report.survivors, findings };
}

// Corre la etapa. `run` va inyectado para poder probar las decisiones sin instalar herramientas ni
// esperar minutos. `changed` son rutas relativas a `root`, ya filtradas a fuentes por el llamador.
// Devuelve { stage, ok, blocked, reason, command, code, ms, score, survivors, findings }.
export async function runMutation(config, { root, changed = [], lines = null, run = runCommand, platform = process.platform } = {}) {
  const cfg = (config && config.mutation) || {};
  const threshold = typeof cfg.threshold === 'number' ? cfg.threshold : 80;
  const ctx = { root, changed, lines, run, platform };

  const early = precheck(cfg, root);
  if (early) return early;
  // Spec 016 (R1): una tarea con archivos pero sin código de producción —solo pruebas, documentos o
  // configuración— no tiene nada que mutar. Correr la herramienta sin acotar no significa «no midas
  // nada»: significa «mide lo que diga la configuración del repo», que puede ser el proyecto entero o
  // una lista de otra HU. Con el alcance vacío manda la spec 013 (R13), así que solo aplica con
  // `changed` lleno.
  if (changed.length && !changed.some(esCodigoMutable)) return { ...BASE, ok: true, skipped: true, reason: 'no-source' };
  const built = await scopedCommand(cfg, ctx);
  if (built.result) return built.result;
  const located = await runAndLocate(cfg, built.command, ctx);
  if (located.result) return located.result;
  const read = await readReport(cfg, located.reportPath, located.ran, ctx);
  return read.result || verdict(read.report, located.ran, threshold);
}
