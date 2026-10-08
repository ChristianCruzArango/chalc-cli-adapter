// Comando `chalc qa`: preflight de specs, bring-up del entorno y agente QA contra la app viva.
// Aquí vive el guion del comando; el entorno, la sesión y el agente tienen su propio módulo.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { t } from '../i18n.mjs';
import { findEnvironmentOptions, guessBaseUrls, listSpecs, normalizeQaUrl, probeDocker, qaComposeProjectName, qaPlanPath, qaResultsPath, readQaInputs, readSpecContext, selectEnvironment, writeBrowserTests, writeQaInputs, writeQaPlan } from '../qa.mjs';
import { parseResultsMarkdown } from '../qaagent.mjs';
import { writeQaRepairPlanArtifact } from '../qaflow.mjs';
import { c, cleanPath, disp, flags, allowExternalExec, interactive, projectArg, projectPath } from './context.mjs';
import { makePrompter } from './prompter.mjs';
import { bringUpEnvironment, startEnvironment } from './qaenv.mjs';
import { loginNow, prepareAgentAuth } from './qaauth.mjs';
import { runAgentAgainstLiveApp } from './qaagentrun.mjs';

export { startEnvironment, bringUpEnvironment, runPlaywrightSpec } from './qaenv.mjs';
export { collectQaCredentials, promptAuthIfNeeded } from './qaauth.mjs';
export { runAgentAgainstLiveApp } from './qaagentrun.mjs';

// 0) Ruta del proyecto: en interactivo se pregunta (default = cwd o el argumento) y se valida.
async function askProject(prompter) {
  let proj = projectPath;
  if (prompter && !projectArg) {
    const ans = await prompter.text(t('qaPathQ', c.dim(`[${proj}]`)));
    if (ans) proj = resolve(cleanPath(ans));
  }
  if (!existsSync(proj)) throw new Error(t('pathMissing', proj));
  return proj;
}

async function printSpecsAndDocker(specs) {
  console.log(c.bold(t('qaSpecsAvailable')));
  specs.forEach((id, index) => console.log(`  ${index + 1}. ${id}`));
  const docker = await probeDocker();
  const mark = docker.installed && docker.daemon && docker.compose ? c.green('✓') : c.yellow('!');
  console.log(`\n${mark} Docker: ${docker.detail}`);
}

// 2) Spec: por bandera o elegida con buscador (escribe para filtrar, ↑/↓ para moverte).
async function pickSpec(prompter, specs, o) {
  const specId = String(o.spec || o.feature || '').trim();
  if (specId && !specs.includes(specId)) throw new Error(t('qaSpecNotFound', specId));
  if (specId || !prompter) return specId;
  return specs[await prompter.select(t('qaWhichSpecQ'), specs.map((id) => ({ label: id })), 0, { search: true })];
}

async function loadContext(proj, specId) {
  const context = await readSpecContext(proj, specId);
  if (context.duplicateRequirements.length) throw new Error(t('qaDupRequirements', context.duplicateRequirements.join(', ')));
  console.log('\n' + c.bold(t('qaSpecSelected', context.id)));
  console.log('  ' + t('qaDocs', Object.keys(context.files).join(', ')));
  console.log('  ' + t('qaRequirements', context.requirements.length ? context.requirements.join(', ') : c.yellow(t('qaNoneDetected'))));
  return context;
}

// Menú principal: el uso normal es guiado; flags solo automatizan CI.
async function pickAction(prompter, o) {
  if (!prompter || o.plan || o.up || o.agent) return 'prepare';
  const actions = [
    { label: t('qaActionPrepare'), value: 'prepare' },
    { label: t('qaActionRun'), value: 'run' },
    { label: t('qaActionReport'), value: 'report' }
  ];
  return actions[await prompter.select(t('qaWhatToDoQ'), actions, 0)].value;
}

async function showReport(proj, context) {
  const report = qaResultsPath(proj, context.id);
  if (existsSync(report)) console.log('\n' + await readFile(report, 'utf8'));
  else console.log(c.yellow('\n! ' + t('qaNoReportYet')));
  return { projectPath: proj, specId: context.id, reported: true, qaResultsPath: report };
}

// 3) Entorno: por bandera (--env, valida) o preguntado. "Decidir luego" deja el plan sin arranque fijado.
async function pickEnvironment(prompter, environments, context, o) {
  let selectedEnv = selectEnvironment(environments, o.env);   // lanza con las opciones válidas si --env no existe
  if (prompter && !o.env && environments.length) {
    const choices = [...environments.map((item) => ({ label: item.label })), { label: c.dim(t('qaDecideLater')) }];
    const picked = await prompter.select(t('qaWhichEnvQ'), choices, choices.length - 1);
    selectedEnv = environments[picked] || null;
  }
  if (selectedEnv) console.log('  ' + t('qaEnvChosen', c.bold(selectedEnv.label)));
  return selectedEnv?.type === 'compose' ? { ...selectedEnv, projectName: qaComposeProjectName(context.id) } : selectedEnv;
}

// 4) Si el plan ya existe, no se machaca sin permiso (preguntado en interactivo, --force en CI).
async function askOverwrite(prompter, proj, context, o) {
  if (o.force) return true;
  if (!prompter || !existsSync(qaPlanPath(proj, context.id))) return false;
  return prompter.yesno(t('qaPlanExistsQ', context.id), false);
}

// 4c) Datos QA: se preguntan sin leer código. Secretos solo por NOMBRE de variable de entorno.
// Default NO: el agente ya prueba con el plan. Esto es opcional y solo afina rutas/credenciales.
async function askQaInputs(prompter, context, existing, o) {
  if (!prompter || o['skip-qa-inputs']) return existing;
  if (!await prompter.yesno(t('qaCaptureDataQ', context.requirements.length), false)) return existing;
  const perCase = await prompter.yesno(t('qaPerCaseQ'), false);
  const cases = [];
  for (const id of context.requirements) {
    cases.push(perCase
      ? { id, path: await prompter.text(t('qaCasePathQ', id)), expected: await prompter.text(t('qaCaseExpectedQ', id)) }
      : { id, path: '', expected: '' });
  }
  const list = async (q) => (await prompter.text(q)).split(',').map((s) => s.trim()).filter(Boolean);
  const allowedPaths = await list(t('qaAllowedPathsQ'));
  const allowWriteMethods = await prompter.yesno(t('qaAuthorizeWritesQ'), false);
  const secretVars = await list(t('qaSecretVarsQ'));
  return { version: 1, cases, allowedPaths, allowWriteMethods, secretVars };
}

// 5) Bring-up (--up) o además agente QA (--agent). Ejecuta comandos/IA: explícito. El agente necesita la app viva.
async function decideRun(prompter, selectedEnv, qaAction, o) {
  let doAgent = !!o.agent;
  let doUp = !!o.up || doAgent;
  if (prompter && !o.up && !o.agent && selectedEnv) {
    doUp = await prompter.yesno(t('qaBringUpQ', selectedEnv.label), qaAction === 'run');
    if (doUp) doAgent = await prompter.yesno(t('qaRunAgentQ'), false);
  }
  return { doUp, doAgent };
}

// URL de salud: con --url manda el usuario; si no, chalc LEE la URL que el server anuncia (y guess como respaldo).
async function healthCandidatesFor(proj, o) {
  const urlFlag = String(o.url || '').trim();
  return urlFlag ? [normalizeQaUrl(urlFlag)] : guessBaseUrls(proj);
}

// Todo lo que se pregunta, de una vez y con el prompter vivo. Devuelve `{ done }` si el comando ya
// terminó (sin spec elegida, o solo ver el reporte), o las decisiones con las que ejecutar.
async function askQaRun(prompter, o) {
  const proj = await askProject(prompter);
  console.log('\n' + c.bold('⚙️  chalc qa') + c.dim(`  ·  ${disp(proj)}`) + '\n');
  const specs = await listSpecs(proj);
  if (!specs.length) throw new Error(t('qaNoSpecs'));
  await printSpecsAndDocker(specs);
  const specId = await pickSpec(prompter, specs, o);
  if (!specId) { console.log(c.dim('\n  ' + t('qaPickSpecHint') + '\n')); return { done: { projectPath: proj, specId: null, skipped: true } }; }
  const context = await loadContext(proj, specId);
  const environments = await findEnvironmentOptions(proj);
  console.log('  ' + t('qaEnvsDetected', environments.length ? environments.map((item) => item.label).join(', ') : c.yellow(t('qaNone'))));
  const qaAction = await pickAction(prompter, o);
  if (qaAction === 'report') return { done: await showReport(proj, context) };
  const selectedEnv = await pickEnvironment(prompter, environments, context, o);
  const overwrite = await askOverwrite(prompter, proj, context, o);
  const qaInputs = await askQaInputs(prompter, context, await readQaInputs(proj, context.id), o);
  const run = await decideRun(prompter, selectedEnv, qaAction, o);
  const auth = run.doAgent ? await prepareAgentAuth(prompter, proj, qaInputs, o) : { qaAuth: null, pendingLogin: null };
  const healthCandidates = run.doUp ? await healthCandidatesFor(proj, o) : [];
  if (!interactive && run.doUp && !allowExternalExec) throw new Error(t('qaNeedsExec'));
  return { o, proj, context, selectedEnv, overwrite, qaInputs, ...run, ...auth, healthCandidates };
}

async function saveInputsAndPlan({ proj, context, selectedEnv, overwrite, qaInputs }) {
  if (qaInputs) {
    console.log(c.green('✓ ' + t('qaInputsSaved', await writeQaInputs(proj, context.id, qaInputs))));
    console.log(c.green('✓ ' + t('qaTestsGenerated', await writeBrowserTests(proj, context, qaInputs))));
  }
  const { path, written } = await writeQaPlan(proj, context, selectedEnv, { overwrite });
  if (written) {
    console.log(c.green('\n✓ ' + t('qaPlanCreated', path)));
    console.log(c.dim('  ' + t('qaPendingNote')));
  } else {
    console.log(c.yellow('\n! ' + t('qaPlanExists', path)));
    console.log(c.dim('  ' + t('qaForceHint')));
  }
}

// --repair-plan sin agente: el plan de reparación sale del último results.md.
async function repairFromResults(proj, context) {
  const report = qaResultsPath(proj, context.id);
  if (!existsSync(report)) throw new Error(t('qaNoResults'));
  const result = parseResultsMarkdown(await readFile(report, 'utf8'));
  const { path } = await writeQaRepairPlanArtifact(proj, context, result);
  console.log(c.green('✓ ' + t('qaRepairPlanSaved', path)));
  return path;
}

// 6) El bring-up (y, si se pidió, el agente), al final y con stdin ya liberado.
async function bringUpAndRun(a) {
  if (!a.selectedEnv) { console.log(c.yellow('\n! ' + t('qaNoEnvSelected'))); return null; }
  if (!a.doAgent) {
    await bringUpEnvironment(a.selectedEnv, a.proj, a.healthCandidates, { guessed: !String(a.o.url || '').trim() });
    console.log(c.dim('  ' + t('qaUpHint')));
    return null;
  }
  const { health, stop } = await startEnvironment(a.selectedEnv, a.proj, a.healthCandidates, { guessed: !String(a.o.url || '').trim() });
  try {
    if (!health.ok) { console.log(c.yellow('  ' + t('qaAppNoResponse'))); return null; }
    // Si el login falla, lanza y aborta el agente (R6); el finally igual baja el entorno.
    const auth = a.pendingLogin ? await loginNow(a.pendingLogin, health.url, a.o) : a.qaAuth;
    return await runAgentAgainstLiveApp(a.context, a.proj, health.url, String(a.o.surface || '').trim() || null, auth, {
      screenshots: a.o.screenshots === true, flags: a.o
    });
  } finally {
    await stop();
  }
}

// ---------- comando: chalc qa ----------
// Preflight QA: specs/documentación y capacidades locales. Con --up levanta el entorno y verifica salud (luego lo baja).
// `options.flags`: las opciones de ESTA corrida (por defecto, las de la línea de comandos). `deliver`
// pasa las suyas en vez de mutar el `flags` del proceso, que es de todos los comandos.
export async function runQa({ flags: o = flags } = {}) {
  // Un solo prompter para todo el flujo interactivo (igual que spec-ia).
  const prompter = interactive ? makePrompter() : null;
  let a;
  try { a = await askQaRun(prompter, o); }
  finally { if (prompter) prompter.close(); }
  if (a.done) return a.done;

  await saveInputsAndPlan(a);
  const repairPlanPath = o['repair-plan'] && !a.doAgent ? await repairFromResults(a.proj, a.context) : null;
  const agentRun = a.doUp ? await bringUpAndRun(a) : null;
  console.log('');
  return {
    projectPath: a.proj,
    specId: a.context.id,
    selectedEnv: a.selectedEnv,
    qaResultsPath: qaResultsPath(a.proj, a.context.id),
    repairPlanPath: repairPlanPath || agentRun?.artifacts?.repairPath || null,
    agentRun
  };
}
