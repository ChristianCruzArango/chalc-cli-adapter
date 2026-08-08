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

import { changedFiles, currentBranch } from './lib/changed.mjs';
import { checkContract } from './lib/contractcheck.mjs';
import { checkTraceability } from './lib/traceability.mjs';
import { contractRoutesWithLines } from './lib/contract-routes.mjs';
import { frameOf, messageOf } from './lib/i18n.mjs';
import { lintBoundariesIn } from './lib/boundaries.mjs';
import { lintChanged } from './lib/smells.mjs';
import { loadConfig } from './lib/config.mjs';
import { newestSpec } from './lib/spec.mjs';
import { renderEvidence, verdictOf, writeEvidence } from './lib/evidence.mjs';
import { RULES } from './lib/rules.mjs';
import { runCommand } from './lib/run.mjs';
import { runMutation } from './lib/mutation.mjs';
import { runTests } from './lib/tests.mjs';

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
  const lang = config.language || 'en';

  // Sin config el portón no sabe qué comprobar. Eso es un bloqueo, no "todo por defecto": lo
  // contrario sería aprobar una tarea por no encontrar un archivo.
  if (error) {
    return finish(root, lang, [{
      stage: 'tests', ok: false, blocked: true, reason: 'no-config', command: '', code: null, ms: 0,
      findings: [{ file: '', line: 0, rule: RULES.noTestCommand, data: { detail: error } }]
    }], { branch: await currentBranch(root), role: '', spec: '' }, fast);
  }

  const files = changed || await changedFiles(root);
  const spec = await newestSpec(root, config.spec.dir, 'spec.md');
  const stages = [];

  // 1. Tests. Todo lo demás depende de esto: mutar o revisar estilo sobre una suite en rojo es
  //    gastar minutos en un informe que nadie va a leer.
  const tests = await runTests(config, { root, run });
  stages.push(tests);

  // 2. Mutación. Se omite por `--fast` (R11) o porque los tests fallaron (R10), y en ambos casos el
  //    informe dice CUÁL de los dos fue.
  if (fast) stages.push(skipped('mutation', 'fast'));
  else if (!tests.ok) stages.push(skipped('mutation', 'tests-failed'));
  else stages.push(await runMutation(config, { root, changed: files, run }));

  // 3. Etapas estáticas: baratas, siempre corren, y son las que dan hallazgos accionables aunque
  //    todo lo demás esté bloqueado.
  const smells = await timed(() => lintChanged(files, { root, limits: config.lint }));
  stages.push(staticStage('smells', smells.value, smells.ms));

  const boundaries = await timed(() => lintBoundariesIn(root, files));
  stages.push(staticStage('boundaries', boundaries.value.map(asFinding), boundaries.ms));

  const traceability = await timed(() => checkTraceability(files, { root, specDir: config.spec.dir }));
  stages.push(staticStage('traceability', traceability.value, traceability.ms));

  const contract = await timed(() => checkContract({
    root, specDir: config.spec.dir, role: config.role, routesOf: contractRoutesWithLines
  }));
  stages.push(staticStage('contract', contract.value, contract.ms));

  return finish(root, lang, stages, { branch: await currentBranch(root), role: config.role, spec: spec ? spec.dir : '' }, fast);
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
async function finish(root, lang, stages, meta, fast) {
  const verdict = verdictOf(stages);
  const markdown = renderEvidence({ stages, meta: { ...meta, date: new Date() }, lang });
  const evidence = await writeEvidence(root, markdown);

  return {
    code: verdict === 'pass' ? 0 : 1,
    verdict,
    // Una corrida rápida no cierra una tarea aunque salga verde: no se midió la calidad de las
    // pruebas, que es justo lo que más cuesta y lo que más se omite.
    closesTask: verdict === 'pass' && !fast,
    stages,
    evidence
  };
}

// Resumen por consola. La evidencia completa está en el archivo; esto es para no tener que abrirlo.
function report(result, lang) {
  const frame = frameOf(lang);
  console.log(`\n${frame.title}: ${frame.verdict[result.verdict]}  ·  ${result.evidence}`);
  for (const stage of result.stages) {
    for (const finding of stage.findings) {
      const where = finding.file ? `${finding.file}:${finding.line}` : frame.stages[stage.stage] || stage.stage;
      console.log(`  ${where} — ${messageOf(finding.rule, finding.data, lang)}`);
    }
  }
  if (!result.closesTask && result.verdict === 'pass') console.log(`\n${frame.fast}`);
}

// Entrada de línea de comandos. Solo corre cuando se invoca el archivo, no al importarlo desde los
// tests de chalc.
if (process.argv[1] && /gate\.mjs$/.test(process.argv[1])) {
  const fast = process.argv.includes('--fast');
  const result = await runGate({ root: process.cwd(), fast });
  const { config } = await loadConfig(process.cwd());
  report(result, config.language || 'en');
  process.exit(result.code);
}
