// Comando `chalc qa`: preflight de specs, bring-up del entorno y agente QA contra la app viva.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { t, lang } from '../i18n.mjs';
import { isConfigured } from '../ai.mjs';
import { buildStartCommand, detectAuth, detectSurface, findEnvironmentOptions, guessBaseUrls, listSpecs, normalizeQaUrl, probeDocker, probePlaywright, qaComposeProjectName, qaPlanPath, qaResultsPath, readQaInputs, readSpecContext, resolveQaAuth, selectEnvironment, writeBrowserTests, writeQaInputs, writeQaPlan } from '../qa.mjs';
import { createBrowserExecutor, httpExecutor, parseResultsMarkdown, runQaAgent } from '../qaagent.mjs';
import { writeQaAgentArtifacts, writeQaRepairPlanArtifact } from '../qaflow.mjs';
import { appendAiTrace, makeAiTrace } from '../aitrace.mjs';
import { procOpts } from '../proc.mjs';
import { c, cleanPath, disp, flags, allowExternalExec, interactive, projectArg, projectPath } from './context.mjs';
import { makePrompter } from './prompter.mjs';
import { printAiLine, resolveAiTaskConfig } from './ai.mjs';
import { resolveLoginConfig, loginFields, loginEndpointPreview, performLogin } from '../qalogin.mjs';

// Pide al SO un puerto libre (bind a :0). Así forzamos el dev server ahí y evitamos choques y adivinanzas.
// Levanta el entorno y espera a que la URL responda. Devuelve { health, stop }: el caller decide cuándo bajarlo.
// NO fuerza el puerto: lee la URL que el propio dev server anuncia (ng/vite/next la imprimen), así respeta
// la config de la app — forzar un puerto random rompe Module Federation (el remoteEntry queda apuntando al viejo).
export async function startEnvironment(env, proj, healthUrls) {
  const candidates = (Array.isArray(healthUrls) ? healthUrls : [healthUrls]).filter(Boolean);
  const start = buildStartCommand(env);   // lanza si el entorno no es arrancable
  const runToEnd = (cmd, args) => new Promise((res) => {
    const p = spawn(cmd, args, procOpts({ cwd: proj, stdio: 'ignore' }));
    p.on('error', () => res(-1));
    p.on('exit', (code) => res(code ?? -1));
  });

  console.log('\n▶ ' + t('qaStarting', c.bold(`${start.command} ${start.args.join(' ')}`)) + '  ' + c.dim('· ' + t('qaDiscoveringUrl')));
  let spawnError = null;
  let childExited = false;
  let discovered = null;   // la URL que el propio dev server reporta en su salida
  const onData = (buf) => {
    const text = buf.toString();
    if (!discovered) {
      const m = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i) || text.match(/listening on\s+(?:localhost|127\.0\.0\.1):(\d+)/i);
      if (m) { discovered = `http://localhost:${m[1]}`; console.log(c.dim('  │ ' + t('qaUrlDetected', discovered))); }
    }
    for (const line of text.split('\n')) if (/error|failed|cannot|compiled|Port \d+ is already/i.test(line)) { const t = line.trim(); if (t) console.log(c.dim(`  │ ${t.slice(0, 160)}`)); }
  };
  // NG_CLI_ANALYTICS=false evita el prompt de analytics de Angular que cuelga en modo no interactivo.
  const child = spawn(start.command, start.args, procOpts({ cwd: proj, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: { ...process.env, NG_CLI_ANALYTICS: 'false' } }));
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('error', (e) => { spawnError = e; childExited = true; });
  child.on('exit', () => { childExited = true; });

  // Prioriza la URL anunciada por el server; cae a los candidatos del guess. Hasta 120s (MFE grande compila lento).
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let health = { ok: false, attempts: 0 };
  for (let attempt = 1; attempt <= 120; attempt++) {
    if (start.down === null && childExited) { health = { ok: false, aborted: true, attempts: attempt - 1 }; break; }
    for (const url of [discovered, ...candidates].filter(Boolean)) {
      try { const res = await fetch(url, { method: 'GET' }); health = { ok: true, status: res.status, attempts: attempt, url }; break; } catch { /* siguiente candidato */ }
    }
    if (health.ok) break;
    await sleep(1000);
  }
  if (spawnError) console.log(c.red('✗ ' + t('qaCannotRun', start.command, spawnError.code || spawnError.message)));
  else if (health.ok) console.log(c.green('✓ ' + t('qaResponds', health.url, health.status, health.attempts)));
  else if (health.aborted) console.log(c.red('✗ ' + t('qaProcessEnded')));
  else console.log(c.red('✗ ' + t('qaNoUrlResponded', discovered || t('qaNoneFem'), candidates.join(' | ') || '—')));

  const stop = async () => {
    console.log(c.dim('  ' + t('qaStoppingEnv')));
    if (start.down) await runToEnd(start.down.command, start.down.args);
    else if (!childExited && !child.killed) {
      if (process.platform === 'win32' && child.pid) {
        // shell:true envuelve el proceso en cmd.exe; taskkill /T baja todo el árbol (incluido el dev server).
        try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { child.kill(); }
      } else if (child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    }
  };
  return { health, stop };
}

// Bring-up de un solo tiro (para --up): levanta, verifica salud y baja inmediatamente.
export async function bringUpEnvironment(env, proj, healthUrl) {
  const { health, stop } = await startEnvironment(env, proj, healthUrl);
  await stop();
  return health;
}

// Lee el .chalc.json del proyecto (opcional, puede no existir o estar corrupto). Devuelve {} si no.
async function readChalcJson(proj) {
  const file = join(proj, '.chalc.json');
  if (!existsSync(file)) return {};
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; }
}

// Recolecta las credenciales de login QA de cada campo del contrato (specs/004-qa-login, R2/R3).
// Precedencia: --auth-<campo> / CHALC_QA_<CAMPO> (gana siempre, sirve para CI) > prompt interactivo
// (default como fallback si se responde vacío) > default del contrato. Un campo requerido sin valor
// en modo no interactivo aborta con un error claro. Los campos `secret` van por prompt oculto.
export async function collectQaCredentials(fields, { prompter, flags = {}, env = {} } = {}) {
  const creds = {};
  for (const f of fields) {
    const explicit = flags[`auth-${f.name}`] != null ? String(flags[`auth-${f.name}`])
      : (env[`CHALC_QA_${f.name.toUpperCase()}`] != null ? String(env[`CHALC_QA_${f.name.toUpperCase()}`]) : '');
    let value = explicit;
    if (!value && prompter) {
      const label = f.default ? `${f.label} [${f.default}]` : f.label;
      value = ((f.secret ? await prompter.secret(label) : await prompter.text(label)) || '').trim();
    }
    if (!value) value = f.default;
    if (!value) throw new Error(t('qaLoginMissingCredential', f.name, `CHALC_QA_${f.name.toUpperCase()}`));
    creds[f.name] = value;
  }
  return creds;
}

// Detecta si la app exige autenticación y, de ser así, le PIDE al usuario la sesión (no falla en silencio).
// Devuelve { headers?, storage? } para inyectar en el navegador, o null si no hace falta / se omite.
// preset: token pasado por flag/env (--auth-token / CHALC_QA_TOKEN); si resuelve, gana SIEMPRE — así
// se prueban endpoints protegidos sin TTY (antes esto dejaba BLOCKED todo endpoint autenticado en CI).
export async function promptAuthIfNeeded(prompter, proj, preset) {
  const fromPreset = resolveQaAuth(preset || {});
  if (fromPreset) return fromPreset;
  const det = await detectAuth(proj);
  if (!det.needsAuth) return null;
  console.log(c.yellow('\n⚠ ' + t('qaAuthRequired', det.signals.join(', '))));
  if (!prompter) {
    console.log(c.dim('  ' + t('qaAuthNonInteractive')));
    return null;
  }
  const methods = [
    { label: t('qaAuthStorage'), value: 'storage' },
    { label: t('qaAuthHeader'), value: 'header' },
    { label: t('qaAuthSkip'), value: 'skip' }
  ];
  const method = methods[await prompter.select(t('qaAuthMethodQ'), methods, det.storageKeys.length ? 0 : 1)].value;
  if (method === 'skip') return null;
  if (method === 'header') {
    const token = (await prompter.secret(t('qaAuthTokenQ'))).trim();
    return token ? { headers: { Authorization: `Bearer ${token}` } } : null;
  }
  const hint = det.storageKeys.length ? t('qaAuthDetected', det.storageKeys.join(', ')) : '';
  const key = (await prompter.text(t('qaAuthStorageKeyQ', hint))).trim();
  const type = (await prompter.yesno(t('qaAuthIsSessionQ'), false)) ? 'session' : 'local';
  const value = (await prompter.secret(t('qaAuthValueQ'))).trim();
  return key && value ? { storage: [{ type, key, value }] } : null;
}

// Ejecuta un spec con el CLI de Playwright del proyecto (la app debe estar viva). Devuelve el exit code.
export function runPlaywrightSpec(proj, testFile, baseUrl) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['playwright', 'test', testFile, '--reporter=line'], procOpts({
      cwd: proj,
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BASE_URL: baseUrl, BASE_URL: baseUrl }
    }));
    child.on('error', () => resolve(-1));
    child.on('exit', (code) => resolve(code ?? -1));
  });
}

// Corre el agente QA contra la app ya viva: detecta/usa superficie, ejecuta el loop y escribe results.md.
export async function runAgentAgainstLiveApp(context, proj, baseUrl, surfaceOverride, auth, { screenshots = false } = {}) {
  const cfg = await resolveAiTaskConfig('qa');
  if (!isConfigured(cfg)) throw new Error(t('qaAgentNeedsAi'));
  printAiLine(cfg);   // muestra qué proveedor/modelo se usará

  const detected = await detectSurface(proj);
  const surface = (surfaceOverride || detected.surface);
  if (surface !== 'web' && surface !== 'api') {
    throw new Error(t('qaSurfaceUnknown', JSON.stringify(detected.signals)));
  }
  console.log('  ' + t('qaSurface', c.bold(surface)) + (surfaceOverride ? c.dim(' ' + t('qaSurfaceForced')) : c.dim(' ' + t('qaSurfaceDetected', detected.signals[surface]?.join(', ') || '—'))));
  if (auth) console.log(c.dim('  ' + t('qaSessionInjected', auth.headers ? t('qaSessionHeader') : t('qaSessionStorage', auth.storage?.[0]?.key))));

  const inputs = await readQaInputs(proj, context.id);
  let executor;
  if (surface === 'web') {
    try { executor = await createBrowserExecutor(baseUrl, { auth, screenshots }); }   // lanza un error guía si falta Playwright
    catch (e) { throw new Error(e.message); }
  } else {
    executor = httpExecutor(baseUrl, {
      headers: auth?.headers || {},   // en api, la sesión va como header en cada petición
      allowedMethods: inputs?.allowWriteMethods ? ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH'] : undefined,
      allowedPaths: inputs?.allowedPaths || []
    });
  }

  try {
    console.log(c.dim('  ' + t('qaRunningAgent')));
    let plan = existsSync(qaPlanPath(proj, context.id)) ? await readFile(qaPlanPath(proj, context.id), 'utf8') : context.files['spec.md'];
    // Si hay sesión inyectada, avisar al agente: cada petición YA lleva la auth. Sin esto el modelo
    // cree que no tiene credenciales, arma un Authorization propio (y falla) y marca todo BLOCKED.
    if (auth) plan = `> NOTA QA: la sesión de autenticación (${auth.headers ? 'header Authorization' : 'storage'}) ya está inyectada en cada petición. NO construyas ni envíes tu propio token/Authorization; asume que estás autenticado.\n\n${plan}`;
    // Presupuesto de pasos según cantidad de requisitos: cada R# necesita 1-3 acciones + el veredicto final.
    // Override con --max-steps. Tope de seguridad para no disparar tokens sin querer.
    const reqCount = context.requirements.length || 1;
    const maxSteps = Math.min(Number(flags['max-steps']) || Math.max(12, reqCount * 3 + 4), 60);
    console.log(c.dim('    ' + t('qaBudget', maxSteps, reqCount)));
    const result = await runQaAgent({
      cfg, surface, baseUrl, plan,
      requirementIds: context.requirements,
      executor,
      maxSteps,
      language: lang === 'en' ? 'English' : 'español',
      ccr: flags.ccr === false ? false : undefined,   // CCR (compresión reversible) activo por defecto
      onStep: (r) => console.log(c.dim('    ' + t('qaStepLine', r.step, r.observation?.ok ? t('qaStepOk') : t('qaStepFail'))))
    });
    if (result.ccr) console.log(c.dim('    ' + t('qaCcrLine', result.ccr.entries, result.ccr.charsSaved)));
    const artifacts = await writeQaAgentArtifacts({
      projectPath: proj,
      context,
      surface,
      baseUrl,
      result,
      repairPlan: !!flags['repair-plan']
    });
    await appendAiTrace(proj, context.id, makeAiTrace({
      task: 'qa',
      provider: cfg.provider,
      model: cfg.model,
      system: plan,
      user: `${surface} ${baseUrl}`,
      output: JSON.stringify(result.verdicts || []),
      extra: { steps: result.steps?.length || 0, ccr: result.ccr || null }
    }));
    const pass = result.verdicts.filter((v) => v.status === 'PASS').length;
    console.log(c.green('\n✓ ' + t('qaResultsSaved', artifacts.resultsPath)));
    console.log('  ' + t('qaPassSummary', pass, result.verdicts.length) + (result.error ? c.yellow(`  (${result.error})`) : ''));
    if (flags['repair-plan']) {
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

    // Web: escribe los pasos verificados como spec Playwright ejecutable y, si hay CLI, los corre (app aún viva).
    if (surface === 'web') {
      console.log(c.green('✓ ' + t('qaReplaySpecSaved', artifacts.replaySpecPath)));
      const pw = await probePlaywright(proj);
      if (pw.available) {
        console.log(c.dim('  ' + t('qaRunningPlaywright', pw.version)));
        const code = await runPlaywrightSpec(proj, artifacts.replaySpecPath, baseUrl);
        if (code === 0) console.log(c.green('  ✓ ' + t('qaPlaywrightPass')));
        else {
          console.log(c.yellow('  ! ' + t('qaPlaywrightFail', code)));
          console.log(c.dim('    ' + t('qaPlaywrightInstallHint')));
        }
      } else {
        console.log(c.dim(`  ${pw.detail}`));
      }
    }
    return { result, artifacts, surface, baseUrl };
  } finally {
    if (typeof executor?.close === 'function') await executor.close();
  }
}

// ---------- comando: chalc qa ----------
// Preflight QA: specs/documentación y capacidades locales. Con --up levanta el entorno y verifica salud (luego lo baja).
export async function runQa() {
  // Un solo prompter para todo el flujo interactivo (igual que spec-ia).
  const prompter = interactive ? makePrompter() : null;
  let proj = projectPath;

  // 0) Ruta del proyecto: en interactivo se pregunta (default = cwd o el argumento) y se valida.
  if (prompter && !projectArg) {
    const ans = await prompter.text(t('qaPathQ', c.dim(`[${proj}]`)));
    if (ans) proj = resolve(cleanPath(ans));
  }
  if (!existsSync(proj)) { if (prompter) prompter.close(); throw new Error(t('pathMissing', proj)); }

  console.log('\n' + c.bold('⚙️  chalc qa') + c.dim(`  ·  ${disp(proj)}`) + '\n');

  // 1) Verificar specs disponibles.
  const specs = await listSpecs(proj);
  if (!specs.length) { if (prompter) prompter.close(); throw new Error(t('qaNoSpecs')); }

  console.log(c.bold(t('qaSpecsAvailable')));
  specs.forEach((id, index) => console.log(`  ${index + 1}. ${id}`));

  const docker = await probeDocker();
  const mark = docker.installed && docker.daemon && docker.compose ? c.green('✓') : c.yellow('!');
  console.log(`\n${mark} Docker: ${docker.detail}`);

  // 2) Spec: por bandera o elegida con buscador (escribe para filtrar, ↑/↓ para moverte).
  let specId = String(flags.spec || flags.feature || '').trim();
  if (specId && !specs.includes(specId)) { if (prompter) prompter.close(); throw new Error(t('qaSpecNotFound', specId)); }
  if (prompter && !specId) {
    specId = specs[await prompter.select(t('qaWhichSpecQ'), specs.map((id) => ({ label: id })), 0, { search: true })];
  }
  if (!specId) {
    if (prompter) prompter.close();
    console.log(c.dim('\n  ' + t('qaPickSpecHint') + '\n'));
    return { projectPath: proj, specId: null, skipped: true };
  }

  const context = await readSpecContext(proj, specId);
  if (context.duplicateRequirements.length) {
    if (prompter) prompter.close();
    throw new Error(t('qaDupRequirements', context.duplicateRequirements.join(', ')));
  }
  console.log('\n' + c.bold(t('qaSpecSelected', context.id)));
  console.log('  ' + t('qaDocs', Object.keys(context.files).join(', ')));
  console.log('  ' + t('qaRequirements', context.requirements.length ? context.requirements.join(', ') : c.yellow(t('qaNoneDetected'))));
  const environments = await findEnvironmentOptions(proj);
  console.log('  ' + t('qaEnvsDetected', environments.length ? environments.map((item) => item.label).join(', ') : c.yellow(t('qaNone'))));

  // Menú principal: el uso normal es guiado; flags solo automatizan CI.
  let qaAction = 'prepare';
  if (prompter && !flags.plan && !flags.up && !flags.agent) {
    const actions = [
      { label: t('qaActionPrepare'), value: 'prepare' },
      { label: t('qaActionRun'), value: 'run' },
      { label: t('qaActionReport'), value: 'report' }
    ];
    qaAction = actions[await prompter.select(t('qaWhatToDoQ'), actions, 0)].value;
    if (qaAction === 'report') {
      const report = qaResultsPath(proj, context.id);
      if (existsSync(report)) console.log('\n' + await readFile(report, 'utf8'));
      else console.log(c.yellow('\n! ' + t('qaNoReportYet')));
      prompter.close();
      return { projectPath: proj, specId: context.id, reported: true, qaResultsPath: report };
    }
  }

  // 3) Entorno: por bandera (--env, valida) o preguntado. "Decidir luego" deja el plan sin arranque fijado.
  let selectedEnv = null;
  try { selectedEnv = selectEnvironment(environments, flags.env); }   // lanza con las opciones válidas si --env no existe
  catch (e) { if (prompter) prompter.close(); throw e; }
  if (prompter && !flags.env && environments.length) {
    const choices = [...environments.map((item) => ({ label: item.label })), { label: c.dim(t('qaDecideLater')) }];
    const picked = await prompter.select(t('qaWhichEnvQ'), choices, choices.length - 1);
    selectedEnv = environments[picked] || null;
  }
  if (selectedEnv) console.log('  ' + t('qaEnvChosen', c.bold(selectedEnv.label)));
  if (selectedEnv?.type === 'compose') selectedEnv = { ...selectedEnv, projectName: qaComposeProjectName(context.id) };

  // 4) Plan: por bandera (--plan) o preguntado.
  let createPlan = !!flags.plan || qaAction === 'prepare' || qaAction === 'run';
  if (prompter && !flags.plan && qaAction !== 'prepare' && qaAction !== 'run') createPlan = await prompter.yesno(t('qaCreatePlanQ'), true);

  // 4b) Si el plan ya existe, no se machaca sin permiso (preguntado en interactivo, --force en CI).
  let overwrite = !!flags.force;
  if (createPlan && !overwrite && existsSync(qaPlanPath(proj, context.id))) {
    if (prompter) overwrite = await prompter.yesno(t('qaPlanExistsQ', context.id), false);
  }

  // 4c) Datos QA: se preguntan sin leer código. Secretos solo por NOMBRE de variable de entorno.
  let qaInputs = await readQaInputs(proj, context.id);
  if (prompter && !flags['skip-qa-inputs'] && (createPlan || !qaInputs)) {
    // Default NO: el agente ya prueba con el plan. Esto es opcional y solo afina rutas/credenciales.
    const capture = await prompter.yesno(t('qaCaptureDataQ', context.requirements.length), false);
    if (capture) {
      const perCase = await prompter.yesno(t('qaPerCaseQ'), false);
      const cases = [];
      for (const id of context.requirements) {
        if (perCase) {
          const path = await prompter.text(t('qaCasePathQ', id));
          const expected = await prompter.text(t('qaCaseExpectedQ', id));
          cases.push({ id, path, expected });
        } else {
          cases.push({ id, path: '', expected: '' });
        }
      }
      const allowedPaths = (await prompter.text(t('qaAllowedPathsQ'))).split(',').map((s) => s.trim()).filter(Boolean);
      const allowWriteMethods = await prompter.yesno(t('qaAuthorizeWritesQ'), false);
      const secretVars = (await prompter.text(t('qaSecretVarsQ'))).split(',').map((s) => s.trim()).filter(Boolean);
      qaInputs = { version: 1, cases, allowedPaths, allowWriteMethods, secretVars };
    }
  }

  // 5) Bring-up (--up) o además agente QA (--agent). Ejecuta comandos/IA: explícito. El agente necesita la app viva.
  let doAgent = !!flags.agent;
  let doUp = !!flags.up || doAgent;
  if (prompter && !flags.up && !flags.agent && selectedEnv) {
    doUp = await prompter.yesno(t('qaBringUpQ', selectedEnv.label), qaAction === 'run');
    if (doUp) doAgent = await prompter.yesno(t('qaRunAgentQ'), false);
  }
  // Si vamos a correr el agente y la app exige auth, PREPARAMOS la sesión aquí (prompter aún vivo), pero
  // el login por red se EJECUTA después de levantar la app (la app todavía no responde en este punto).
  // Orden: (1) token directo --auth-token/CHALC_QA_TOKEN gana SIEMPRE (R7, CI o token externo);
  // (2) si no, y el proyecto define un contrato de login QA, chalc pide las credenciales y hace el
  // login él mismo — el humano no pega JWTs (specs/004-qa-login); (3) si no, el flujo de siempre.
  const directToken = flags['auth-token'] || process.env.CHALC_QA_TOKEN || '';
  let qaAuth = null;                 // sesión ya resuelta (token directo o flujo interactivo clásico)
  let pendingLogin = null;           // { config, credentials } — login diferido a después del bring-up
  if (doAgent) {
    if (directToken) {
      qaAuth = await promptAuthIfNeeded(prompter, proj, { token: directToken });
    } else {
      const loginCfg = resolveLoginConfig(await readChalcJson(proj), qaInputs);
      if (loginCfg) {
        const preview = loginEndpointPreview(loginCfg);
        if (prompter) {
          const approved = await prompter.yesno(t('qaLoginConfirm', preview.method, preview.url), false);
          if (!approved) throw new Error(t('qaLoginCancelled'));
        } else if (!flags['allow-login']) {
          throw new Error(t('qaLoginNeedsApproval'));
        }
        const credentials = await collectQaCredentials(loginFields(loginCfg), { prompter, flags, env: process.env });
        pendingLogin = { config: loginCfg, credentials };   // se ejecuta cuando la app esté viva
      } else {
        qaAuth = await promptAuthIfNeeded(prompter, proj);
      }
    }
  }
  // URL de salud: con --url manda el usuario; si no, chalc LEE la URL que el server anuncia (y guess como respaldo).
  let healthCandidates = [];
  if (doUp) {
    const urlFlag = String(flags.url || '').trim();
    healthCandidates = urlFlag ? [normalizeQaUrl(urlFlag)] : await guessBaseUrls(proj);
  }
  if (!interactive && doUp && !allowExternalExec) throw new Error(t('qaNeedsExec'));
  if (prompter) prompter.close();

  if (qaInputs) {
    const inputsPath = await writeQaInputs(proj, context.id, qaInputs);
    console.log(c.green('✓ ' + t('qaInputsSaved', inputsPath)));
    const testsPath = await writeBrowserTests(proj, context, qaInputs);
    console.log(c.green('✓ ' + t('qaTestsGenerated', testsPath)));
  }

  // Plan (sin early-return: el bring-up debe poder ejecutarse después).
  if (createPlan) {
    const { path, written } = await writeQaPlan(proj, context, selectedEnv, { overwrite });
    if (written) {
      console.log(c.green('\n✓ ' + t('qaPlanCreated', path)));
      console.log(c.dim('  ' + t('qaPendingNote')));
    } else {
      console.log(c.yellow('\n! ' + t('qaPlanExists', path)));
      console.log(c.dim('  ' + t('qaForceHint')));
    }
  } else {
    console.log(c.dim('\n  ' + t('qaPreflightDone')));
  }

  let repairPlanPath = null;
  let agentRun = null;
  if (flags['repair-plan'] && !doAgent) {
    const report = qaResultsPath(proj, context.id);
    if (!existsSync(report)) throw new Error(t('qaNoResults'));
    const result = parseResultsMarkdown(await readFile(report, 'utf8'));
    // Reusa el helper de qaflow (crea el dir qa/ si falta): evita duplicar la lógica ya extraída.
    const { path: repairPath } = await writeQaRepairPlanArtifact(proj, context, result);
    repairPlanPath = repairPath;
    console.log(c.green('✓ ' + t('qaRepairPlanSaved', repairPath)));
  }

  // 6) Ejecuta el bring-up (y, si se pidió, el agente) al final, con stdin ya liberado.
  if (doUp) {
    if (!selectedEnv) console.log(c.yellow('\n! ' + t('qaNoEnvSelected')));
    else if (doAgent) {
      const { health, stop } = await startEnvironment(selectedEnv, proj, healthCandidates);
      try {
        if (health.ok) {
          // Login diferido: ahora que la app responde, chalc se autentica con las credenciales
          // recolectadas. Si falla, lanza y aborta el agente (R6) — el finally igual baja el entorno.
          if (pendingLogin) {
            console.log(c.dim('  ' + t('qaLoginInProgress', loginEndpointPreview(pendingLogin.config).url)));
            const token = await performLogin(pendingLogin.config, pendingLogin.credentials, {
              baseUrl: health.url,
              allowExternal: flags['allow-external-login'] === true
            });
            console.log(c.green('  ✓ ' + t('qaLoginOk')));
            qaAuth = resolveQaAuth({ token });
          }
          agentRun = await runAgentAgainstLiveApp(context, proj, health.url, String(flags.surface || '').trim() || null, qaAuth, {
            screenshots: flags.screenshots === true
          });
        } else console.log(c.yellow('  ' + t('qaAppNoResponse')));
      } finally {
        await stop();
      }
    } else {
      await bringUpEnvironment(selectedEnv, proj, healthCandidates);
      console.log(c.dim('  ' + t('qaUpHint')));
    }
  }
  console.log('');
  return {
    projectPath: proj,
    specId: context.id,
    selectedEnv,
    qaResultsPath: qaResultsPath(proj, context.id),
    repairPlanPath: repairPlanPath || agentRun?.artifacts?.repairPath || null,
    agentRun
  };
}
