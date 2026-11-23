// gate.mjs — el portón de calidad. Responsabilidad ÚNICA: decidir qué etapas corren, en qué orden, y
// con qué código sale el proceso. Razón de cambio: la composición del portón.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/`. Se ejecuta con `node .chalc/gate.mjs` y se
// REGENERA al equipar el repo: no lo edites, ajusta `.chalc/gate.json`.
//
// Para qué existe: el método SDD exige tests, mutación, una cosa por archivo, fronteras, trazabilidad
// y contrato. Todo eso vivía en prosa que un asistente podía dar por hecho sin ejecutar nada. Aquí es
// código: corre, mide, y escribe en `.chalc/gate.md` la evidencia con la que cualquiera puede
// comprobarlo. Lo que no se puede comprobar, se bloquea; nunca se aprueba por defecto.

import { currentBranch, headCommit, taskScope } from './lib/changed.mjs';
import { readBaseline, resealConfig as resealBaseline, sealBaseline } from './lib/baseline.mjs';
import { commandChanges, configChanges, guardedConfig, scopeHash } from './lib/fingerprint.mjs';
import { clearTouched } from './lib/touched.mjs';
import { approvalIn, approveCommand } from './lib/approvecli.mjs';
import { checkContract } from './lib/contractcheck.mjs';
import { coherenceStage } from './lib/coherencestage.mjs';
import { configStage, noConfigStage, scopeStage, toolingStage } from './lib/blockstages.mjs';
import { hookIo, runHook } from './lib/hook.mjs';
import { ciCheck } from './lib/cicheck.mjs';
import { redCommand } from './lib/redcli.mjs';
import { tddStage } from './lib/tddstage.mjs';
import { lintTests } from './lib/testsmells.mjs';
import { structureFindings } from './lib/structure.mjs';
import { integrityProblems } from './lib/integrity.mjs';
import { checkTraceability, untestedRequirements } from './lib/traceability.mjs';
import { contractRoutesWithLines } from './lib/contract-routes.mjs';
import { frameOf, messageOf } from './lib/i18n.mjs';
import { lintBoundariesIn } from './lib/boundaries.mjs';
import { lintChanged } from './lib/smells.mjs';
import { scanDuplication } from './lib/duplication.mjs';
import { lintSecurity } from './lib/security.mjs';
import { loadConfig } from './lib/config.mjs';
import { activeSpecDir } from './lib/spec.mjs';
import { renderEvidence, renderState, verdictOf, writeEvidence, writeState } from './lib/evidence.mjs';
import { noteFailure } from './lib/lessons.mjs';
import { RULES } from './lib/rules.mjs';
import { runCommand } from './lib/run.mjs';
import { runMutation } from './lib/mutation.mjs';
import { runTests } from './lib/tests.mjs';
import { runBuild } from './lib/build.mjs';

// Una etapa estática: no ejecuta comandos, solo mira archivos. Pasa si no encontró nada.
const staticStage = (stage, findings, ms) => ({
  stage, ok: findings.length === 0, blocked: false, reason: '', command: '', code: null, ms, findings
});

// Etapa saltada con su motivo, que el informe distingue: no es lo mismo `--fast` que tests en rojo.
const skipped = (stage, reason) => ({
  stage, ok: true, blocked: false, skipped: true, reason, command: '', code: null, ms: 0, findings: []
});

const timed = async (fn) => {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
};

// Corre el portón sobre `root`. `run` y `changed` se inyectan para poder probar las decisiones sin
// ejecutar herramientas reales. Devuelve { code, verdict, closesTask, stages, evidence }.
export async function runGate({ root = process.cwd(), fast = false, run = runCommand, changed = null } = {}) {
  const { config, error } = await loadConfig(root);
  const out = { root, lang: config.language || 'en', fast };

  // Sin config el portón no sabe qué comprobar. Eso es un bloqueo, no "todo por defecto": lo
  // contrario sería aprobar una tarea por no encontrar un archivo.
  if (error) return finish(out, [noConfigStage(error)], { branch: await currentBranch(root), role: '', spec: '' });

  // El alcance: qué archivos revisa esta corrida (spec 013). Una lista inyectada ES un alcance
  // determinado —los tests del portón la usan para no depender de git— y se respeta tal cual.
  const scope = changed ? { files: changed, source: 'given', undetermined: false, from: '' } : await taskScope(root);
  const spec = await activeSpecDir(root, config.spec.dir);
  // El alcance viaja en la meta hasta la evidencia y el estado (R7): sin dejar escrito sobre qué se
  // miró, un informe sin hallazgos no se distingue de un informe que no miró nada.
  // Las claves de gate.json que cambiaron desde que se cerró la tarea anterior (F-07): no bloquean
  // —el usuario ajusta su portón—, pero la evidencia y el advisor lo dicen.
  const changedConfig = configChanges((await readBaseline(root)).config, config);
  const meta = { branch: await currentBranch(root), role: config.role, spec: spec.dir || '', scope, config, configChanges: changedConfig };
  const { blocking, coherence } = await preflight(root, config, { changedConfig, scope });
  if (blocking) return finish(out, [blocking], meta);

  const task = { root, files: scope.files, scope };
  const stages = [...(coherence ? [coherence] : []), ...await executedStages(config, { ...task, run, fast }), ...await staticStages(config, task)];
  return finish(out, stages, meta);
}

// Lo que impide revisar nada todavía, como etapa (`blocking`), en el orden en que se comprueba; y la etapa
// `coherence` cuando pasó, para que figure en el informe.
async function preflight(root, config, { changedConfig, scope }) {
  // Integridad (spec 029, R8): con una herramienta de `.chalc/` alterada no se mide nada. Va la primera porque
  // todo lo demás lo decide ese mismo código.
  const altered = await integrityProblems(root);
  if (altered.length) return { blocking: toolingStage(altered) };

  // Un COMANDO cambiado sí bloquea (S7b): se ejecuta con shell en cada turno (hook `Stop`). Un PR que reescribe
  // `test.command` no corre solo: el usuario lo revisa y re-sella con `--seal`.
  if (commandChanges(changedConfig).length) return { blocking: configStage(commandChanges(changedConfig)) };

  // Coherencia (spec 024, R17): la primera etapa. Con la HU, la spec, el plan y las tareas sin cuadrar —o sin
  // la aprobación del usuario— no se corre un solo test: medir código de una spec que nadie validó no sirve.
  const coherence = await coherenceStage(root, config.spec.dir);
  if (coherence && !coherence.ok) return { blocking: coherence };

  // Sin saber QUÉ revisar no se revisa (R4b). La salida histórica era el árbol de fuentes entero, y
  // eso no es revisar de más: es cambiar de pregunta sin avisar, y enterrar la tarea de hoy bajo la
  // deuda de tres años. Es un bloqueo —"no pude comprobarlo"—, no un fallo.
  if (scope.undetermined) return { blocking: scopeStage(RULES.scopeUndetermined, {}, true) };

  // Sabiendo que no cambió nada, se dice y no se aprueba (R13). "No hay nada que revisar" y "está
  // todo bien" no son lo mismo: confundirlos cierra tareas sin una línea de código medida.
  //
  // Aquí caen también las tareas cuyo único cambio no es fuente —solo documentación, solo config— y
  // las que solo borran archivos. No es un descuido: el portón mide código, y de esas no tiene nada
  // que medir. El informe dice exactamente eso, que es lo que permite decidir a quien lo lea.
  if (!scope.files.length) return { blocking: scopeStage(RULES.scopeEmpty, { from: scope.from }, false) };
  return { blocking: null, coherence };
}

// Las etapas que ejecutan herramientas del repo: tests, compilación y mutación.
async function executedStages(config, { root, files, scope, run, fast }) {
  // 1. Tests. Todo lo demás depende de esto: mutar o revisar estilo sobre una suite en rojo es
  //    gastar minutos en un informe que nadie va a leer.
  const tests = await runTests(config, { root, run });

  // 2. Compilación (spec 018, R1). Corre también con `--fast` y con los tests en rojo: es barata, y
  //    «no compila» es justo lo que un runner tolerante esconde.
  const build = await runBuild(config, { root, run });

  // 3. Mutación. Se omite por `--fast` (R11), porque los tests fallaron (R10) o porque no compila, y el
  //    informe dice CUÁL fue.
  if (fast) return [tests, build, skipped('mutation', 'fast')];
  if (!tests.ok) return [tests, build, skipped('mutation', 'tests-failed')];
  if (!build.ok) return [tests, build, skipped('mutation', 'build-failed')];
  return [tests, build, await runMutation(config, { root, changed: files, lines: scope.lines, run })];
}

// 3. Etapas estáticas: baratas, siempre corren, y son las que dan hallazgos accionables aunque todo
//    lo demás esté bloqueado. El orden va de más local a más global: primero el archivo, luego el
//    repo, luego las fronteras.
async function staticStages(config, { root, files, scope }) {
  // Test-First con evidencia (spec 030, R5): el rojo registrado y los tests sellados, antes que nada más.
  const stages = [await tddStage(root, { files, specDir: config.spec.dir })];

  const smells = await timed(() => lintChanged(files, { root, limits: config.lint, lines: scope.lines, removed: scope.removed }));
  // Con los tests que no prueban nada (spec 030, R9): son olores del código de pruebas.
  stages.push(staticStage('smells', [...smells.value, ...await lintTests(files, { root, lines: scope.lines })], smells.ms));

  // Duplicación (spec 012): mira el árbol entero, pero solo reporta lo que tiene una punta en algo
  // que la tarea tocó. Va junto a `smells` porque las dos leen el mismo texto. Si el recorrido se
  // acotó por `maxFiles`, la etapa lo lleva y la evidencia lo dice aunque no haya hallazgos (G-04).
  const duplication = await timed(() => scanDuplication(root, files, config.lint?.duplication, scope.lines));
  stages.push({ ...staticStage('duplication', duplication.value.findings, duplication.ms), capped: duplication.value.capped });

  // Seguridad (spec 014): las señales que se pueden afirmar con archivo y línea. Apagarla es una
  // decisión escrita en gate.json, y aun así el informe dice que se apagó (R14).
  stages.push(await securityStage(config, { root, files, lines: scope.lines }));

  const boundaries = await timed(() => lintBoundariesIn(root, files));
  // Con dónde NACE el código (spec 031, R3): un archivo nuevo fuera de la arquitectura acordada.
  stages.push(staticStage('boundaries', [...boundaries.value.map(asFinding), ...structureFindings(scope, config)], boundaries.ms));

  const traceability = await timed(() => checkTraceability(files, { root, specDir: config.spec.dir }));
  // En los dos sentidos (spec 030, R10): cada test cita un requisito real, y cada requisito de la tarea tiene test.
  const untested = await untestedRequirements(files, { root, specDir: config.spec.dir });
  stages.push(staticStage('traceability', [...traceability.value, ...untested], traceability.ms));

  const contract = await timed(() => checkContract({
    root, specDir: config.spec.dir, role: config.role, routesOf: contractRoutesWithLines
  }));
  stages.push(staticStage('contract', contract.value, contract.ms));

  return stages;
}

// La etapa de seguridad. Lleva además lo suprimido con `chalc-allow`, que no cuenta como hallazgo
// pero la evidencia tiene que mostrar: una supresión que nadie ve es una etapa apagada por partes.
async function securityStage(config, { root, files, lines }) {
  if (config.security?.enabled === false) return skipped('security', 'disabled');
  const security = await timed(() => lintSecurity(files, { root, lines }));
  return { ...staticStage('security', security.value.findings, security.ms), allowed: security.value.allowed };
}

// Una violación de frontera, en el formato común de hallazgo.
const asFinding = (v) => ({
  file: v.file,
  line: v.line,
  rule: v.kind === 'feature' ? RULES.featureBoundary : RULES.layerBoundary,
  data: { from: v.from, to: v.to, import: v.import }
});

// Escribe la evidencia y decide el código de salida. El veredicto sale de `verdictOf`, el MISMO
// cálculo que titula el informe: si el archivo dijera "APROBADO" y el proceso saliera con 1, la
// evidencia dejaría de serlo.
// `out` dice dónde y cómo se escribe: { root, lang, fast }.
async function finish({ root, lang, fast }, stages, meta) {
  const verdict = verdictOf(stages);
  // Una corrida rápida no cierra una tarea aunque salga verde: no se midió la calidad de las
  // pruebas, que es justo lo que más cuesta y lo que más se omite.
  const closesTask = verdict === 'pass' && !fast;

  // La evidencia queda atada al CONTENIDO revisado y al commit: el advisor recalcula la huella y una
  // edición posterior (o un estado copiado de otra corrida) deja de contar como vigente.
  const stamped = {
    ...meta,
    date: new Date(),
    head: await headCommit(root),
    scopeHash: await scopeHash(root, meta.scope?.files || [])
  };
  const evidence = await writeEvidence(root, renderEvidence({ stages, meta: stamped, lang }));

  // El mismo resultado, para el advisor (spec 008, R13). Se escribe aquí y no en otro sitio para
  // que informe y estado no puedan discrepar: misma corrida, misma fecha, mismo `verdictOf`.
  await writeState(root, renderState({ stages, meta: stamped, fast }));
  if (verdict !== 'pass') await noteFailure(root, stages);   // spec 036, R4: lo que se repite queda como candidata

  if (closesTask) await sealTask(root, meta.config);

  return { code: verdict === 'pass' ? 0 : 1, verdict, closesTask, stages, evidence };
}

// Cierra la tarea de cara al alcance (spec 013, R1): sella dónde termina, y vacía el registro para
// que la siguiente no herede sus archivos.
//
// Solo se llama cuando la corrida CIERRA tarea. Sellar en una corrida que falló movería la
// referencia al medio de la tarea en curso, y a partir de ahí el portón revisaría solo lo escrito
// después de ese punto. Un alcance de menos es el error peligroso: no se nota, porque aprueba.
//
// Sin git no hay commit que sellar y `sealBaseline` se niega —una referencia inservible es peor que
// ninguna, que al menos tiene respaldo declarado (R4)—. El registro se vacía igual: es de la tarea
// que acaba de cerrarse, venga de donde venga.
async function sealTask(root, config) {
  await sealBaseline(root, { commit: await headCommit(root), config: config ? guardedConfig(config) : null });
  await clearTouched(root);
}

/** Re-sella las claves vigiladas de la config actual (`--seal`). Devuelve false si no hay tarea sellada. */
export async function resealConfig(root) {
  const { config, error } = await loadConfig(root);
  if (error) return false;
  return resealBaseline(root, guardedConfig(config));
}

// Resumen por consola. La evidencia completa está en el archivo; esto es para no tener que abrirlo.
// Va a stdout porque es la salida de la CLI, no depuración.
const say = (text) => process.stdout.write(`${text}\n`);

/** Escribe el resumen de `result` con `write` (stdout por defecto). */
export function report(result, lang, write = say) {
  const frame = frameOf(lang);
  write(`\n${frame.title}: ${frame.verdict[result.verdict]}  ·  ${result.evidence}`);
  for (const stage of result.stages) {
    for (const finding of stage.findings) {
      const where = finding.file ? `${finding.file}:${finding.line}` : frame.stages[stage.stage] || stage.stage;
      write(`  ${where} — ${messageOf(finding.rule, finding.data, lang)}`);
    }
  }
  if (!result.closesTask && result.verdict === 'pass') write(`\n${frame.fast}`);
}

/** ¿`argv` es una invocación directa de este archivo (y no un import desde los tests)? */
export const isEntry = (argv) => Boolean(argv[1]) && /gate\.mjs$/.test(argv[1]);

// El portón al servicio de un hook de git: mismo código, y el resumen de la corrida rápida si la hay.
async function hookMode(name, root, write) {
  const lang = (await loadConfig(root)).config.language || 'en';
  const fastGate = async () => { const result = await runGate({ root, fast: true }); report(result, lang, write); return result.code; };
  return runHook(name, hookIo(root, { lang, fastGate, write }));
}

/**
 * Entrada de línea de comandos: `--approve-spec` y `--approve-feature` sellan la spec y el cierre (solo el usuario,
 * desde su terminal), `--seal` re-sella los comandos; si no, corre el portón. `io` inyecta la terminal en los tests. Devuelve el código de salida.
 */
export async function main({ argv = process.argv, root = process.cwd(), write = say, io } = {}) {
  if (approvalIn(argv)) return approveCommand({ root, write, io, kind: approvalIn(argv) });
  // Llamado por un hook de git (spec 029, R4, R5): `--hook pre-commit` mide en rápido; `--hook pre-push` solo comprueba.
  if (argv.includes('--hook')) return hookMode(argv[argv.indexOf('--hook') + 1], root, write);
  // En CI (spec 029, R11): integridad del tooling y coherencia y aprobación de la spec; sin medir código.
  if (argv.includes('--ci')) return ciCheck(root, write);
  // El rojo de la tarea (spec 030): los tests fallan ANTES de que exista su código, y queda escrito.
  if (argv.includes('--red')) return redCommand({ root, argv, write });
  if (argv.includes('--seal')) {
    const sealed = await resealConfig(root);
    const frame = frameOf((await loadConfig(root)).config.language || 'en');
    write(sealed ? frame.sealed : frame.nothingToSeal);
    return sealed ? 0 : 1;
  }
  const result = await runGate({ root, fast: argv.includes('--fast') });
  const { config } = await loadConfig(root);
  report(result, config.language || 'en', write);
  return result.code;
}

// Solo corre cuando se invoca el archivo, no al importarlo desde los tests de chalc.
if (isEntry(process.argv)) process.exit(await main());
