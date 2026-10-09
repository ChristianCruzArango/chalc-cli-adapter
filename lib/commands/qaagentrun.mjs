// El agente de `chalc qa` contra la app ya viva: superficie, executor, loop, artefactos y replay.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { t, lang } from '../i18n.mjs';
import { isConfigured } from '../ai.mjs';
import { detectSurface, probePlaywright, qaPlanPath, readQaInputs } from '../qa.mjs';
import { createBrowserExecutor, httpExecutor, runQaAgent } from '../qaagent.mjs';
import { writeQaAgentArtifacts } from '../qaflow.mjs';
import { appendAiTrace, makeAiTrace } from '../aitrace.mjs';
import { c, flags } from './context.mjs';
import { printAiLine, resolveAiTaskConfig } from './ai.mjs';
import { runPlaywrightSpec } from './qaenv.mjs';

async function resolveSurface(proj, surfaceOverride, auth) {
  const detected = await detectSurface(proj);
  const surface = (surfaceOverride || detected.surface);
  if (surface !== 'web' && surface !== 'api') {
    throw new Error(t('qaSurfaceUnknown', JSON.stringify(detected.signals)));
  }
  console.log('  ' + t('qaSurface', c.bold(surface)) + (surfaceOverride ? c.dim(' ' + t('qaSurfaceForced')) : c.dim(' ' + t('qaSurfaceDetected', detected.signals[surface]?.join(', ') || '—'))));
  if (auth) console.log(c.dim('  ' + t('qaSessionInjected', auth.headers ? t('qaSessionHeader') : t('qaSessionStorage', auth.storage?.[0]?.key))));
  return surface;
}

async function makeExecutor({ surface, baseUrl, auth, inputs, screenshots }) {
  if (surface === 'web') {
    try { return await createBrowserExecutor(baseUrl, { auth, screenshots }); }   // lanza un error guía si falta Playwright
    catch (e) { throw new Error(e.message); }
  }
  return httpExecutor(baseUrl, {
    headers: auth?.headers || {},   // en api, la sesión va como header en cada petición
    allowedMethods: inputs?.allowWriteMethods ? ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH'] : undefined,
    allowedPaths: inputs?.allowedPaths || []
  });
}

// El plan que lee el agente. Si hay sesión inyectada, se le avisa: cada petición YA lleva la auth.
// Sin esto el modelo cree que no tiene credenciales, arma un Authorization propio (y falla) y marca
// todo BLOCKED.
async function agentPlan(proj, context, auth) {
  const plan = existsSync(qaPlanPath(proj, context.id)) ? await readFile(qaPlanPath(proj, context.id), 'utf8') : context.files['spec.md'];
  if (!auth) return plan;
  return `> NOTA QA: la sesión de autenticación (${auth.headers ? 'header Authorization' : 'storage'}) ya está inyectada en cada petición. NO construyas ni envíes tu propio token/Authorization; asume que estás autenticado.\n\n${plan}`;
}

// Presupuesto de pasos según cantidad de requisitos: cada R# necesita 1-3 acciones + el veredicto final.
// Override con --max-steps. Tope de seguridad para no disparar tokens sin querer.
function stepBudget(context, o) {
  const reqCount = context.requirements.length || 1;
  const maxSteps = Math.min(Number(o['max-steps']) || Math.max(12, reqCount * 3 + 4), 60);
  console.log(c.dim('    ' + t('qaBudget', maxSteps, reqCount)));
  return maxSteps;
}

async function traceRepair(proj, context, artifacts) {
  const repairCfg = await resolveAiTaskConfig('repair');
  printAiLine(repairCfg);   // el modelo de repair puede diferir del de qa
  await appendAiTrace(proj, context.id, makeAiTrace({
    task: 'repair',
    provider: repairCfg.provider,
    model: repairCfg.model,
    system: artifacts.resultsMarkdown,
    user: 'build repair plan from QA results',
    output: artifacts.repairPath,
    extra: { source: 'deterministic' }
  }));
  console.log(c.green('✓ ' + t('qaRepairPlanSaved', artifacts.repairPath)));
}

// Web: los pasos verificados quedan como spec Playwright ejecutable y, si hay CLI, se corren (app aún viva).
async function replayInPlaywright(proj, replaySpecPath, baseUrl) {
  console.log(c.green('✓ ' + t('qaReplaySpecSaved', replaySpecPath)));
  const pw = await probePlaywright(proj);
  if (!pw.available) { console.log(c.dim(`  ${pw.detail}`)); return; }
  console.log(c.dim('  ' + t('qaRunningPlaywright', pw.version)));
  const code = await runPlaywrightSpec(proj, replaySpecPath, baseUrl);
  if (code === 0) { console.log(c.green('  ✓ ' + t('qaPlaywrightPass'))); return; }
  console.log(c.yellow('  ! ' + t('qaPlaywrightFail', code)));
  console.log(c.dim('    ' + t('qaPlaywrightInstallHint')));
}

// El loop del agente, sus artefactos y su traza de IA.
async function runAgentLoop({ cfg, proj, context, surface, baseUrl, auth, executor, o }) {
  console.log(c.dim('  ' + t('qaRunningAgent')));
  const plan = await agentPlan(proj, context, auth);
  const result = await runQaAgent({
    cfg, surface, baseUrl, plan,
    requirementIds: context.requirements,
    executor,
    maxSteps: stepBudget(context, o),
    language: lang === 'en' ? 'English' : 'español',
    ccr: o.ccr === false ? false : undefined,   // CCR (compresión reversible) activo por defecto
    onStep: (r) => console.log(c.dim('    ' + t('qaStepLine', r.step, r.observation?.ok ? t('qaStepOk') : t('qaStepFail'))))
  });
  if (result.ccr) console.log(c.dim('    ' + t('qaCcrLine', result.ccr.entries, result.ccr.charsSaved)));
  const artifacts = await writeQaAgentArtifacts({ projectPath: proj, context, surface, baseUrl, result, repairPlan: !!o['repair-plan'] });
  await appendAiTrace(proj, context.id, makeAiTrace({
    task: 'qa', provider: cfg.provider, model: cfg.model,
    system: plan, user: `${surface} ${baseUrl}`, output: JSON.stringify(result.verdicts || []),
    extra: { steps: result.steps?.length || 0, ccr: result.ccr || null }
  }));
  return { result, artifacts };
}

// Corre el agente QA contra la app ya viva: detecta/usa superficie, ejecuta el loop y escribe results.md.
// live: { baseUrl, surfaceOverride, auth, screenshots, flags } — la app viva y cómo se le habla.
export async function runAgentAgainstLiveApp(context, proj, { baseUrl, surfaceOverride = null, auth = null, screenshots = false, flags: o = flags } = {}) {
  const cfg = await resolveAiTaskConfig('qa');
  if (!isConfigured(cfg)) throw new Error(t('qaAgentNeedsAi'));
  printAiLine(cfg);   // muestra qué proveedor/modelo se usará
  const surface = await resolveSurface(proj, surfaceOverride, auth);
  const executor = await makeExecutor({ surface, baseUrl, auth, inputs: await readQaInputs(proj, context.id), screenshots });
  try {
    const { result, artifacts } = await runAgentLoop({ cfg, proj, context, surface, baseUrl, auth, executor, o });
    const pass = result.verdicts.filter((v) => v.status === 'PASS').length;
    console.log(c.green('\n✓ ' + t('qaResultsSaved', artifacts.resultsPath)));
    console.log('  ' + t('qaPassSummary', pass, result.verdicts.length) + (result.error ? c.yellow(`  (${result.error})`) : ''));
    if (o['repair-plan']) await traceRepair(proj, context, artifacts);
    if (surface === 'web') await replayInPlaywright(proj, artifacts.replaySpecPath, baseUrl);
    return { result, artifacts, surface, baseUrl };
  } finally {
    if (typeof executor?.close === 'function') await executor.close();
  }
}
