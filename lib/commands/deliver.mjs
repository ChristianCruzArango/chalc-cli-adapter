// Comando `chalc deliver`: pipeline QA → repair-gate → verify, con rerun de confirmación tras reparar.

import { t } from '../i18n.mjs';
import { actionableVerdicts, buildDeliverRerunCommand, deliverQaFlagPatch } from '../deliverflow.mjs';
import { verifyProject } from '../verify.mjs';
import { environmentKey } from '../qa.mjs';
import { c, disp, flags, allowExternalExec, interactive, projectPath } from './context.mjs';
import { runQa } from './qa.mjs';
import { printVerification } from './init.mjs';

export async function withTemporaryFlags(patch, fn) {
  const previous = new Map();
  const missing = new Set();
  for (const [key, value] of Object.entries(patch)) {
    if (Object.prototype.hasOwnProperty.call(flags, key)) previous.set(key, flags[key]);
    else missing.add(key);
    flags[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const key of missing) delete flags[key];
    for (const [key, value] of previous) flags[key] = value;
  }
}

export async function runDeliverQaStage() {
  return withTemporaryFlags(deliverQaFlagPatch(), () => runQa());
}

export async function runDeliverVerifyStage(proj) {
  console.log('\n' + c.bold(t('deliverVerifyStage')));
  const verification = await verifyProject(proj);
  const ok = printVerification(verification);
  if (!ok && flags.strict) process.exit(1);
  return ok;
}

export async function runDeliverRerunStage() {
  console.log('\n' + c.bold(t('deliverRerunStage')));
  const qa = await runDeliverQaStage();
  if (!qa?.agentRun) throw new Error(t('deliverQaIncomplete'));
  return qa;
}

export function deliverRerunCommandFromSummary(qa) {
  return buildDeliverRerunCommand({
    projectPath: qa?.projectPath || projectPath,
    specId: qa?.specId || flags.spec,
    env: flags.env || environmentKey(qa?.selectedEnv),
    url: flags.url,
    surface: flags.surface,
    allowExec: allowExternalExec || !interactive
  });
}

export async function runDeliver() {
  if (!interactive && !flags.spec) throw new Error(t('deliverNeedsSpec'));
  if (!interactive && !flags.env) throw new Error(t('deliverNeedsEnv'));

  console.log('\n' + c.bold('🚚 chalc deliver') + c.dim(`  ·  ${disp(projectPath)}`) + '\n');

  if (flags.rerun) {
    const ok = await runDeliverVerifyStage(projectPath);
    if (!ok) {
      console.log(c.yellow('! ' + t('deliverVerifyFailed')));
      return;
    }
    // El rerun DEBE validar sus propios verdicts: si el QA de confirmación sigue en FAIL/BLOCKED,
    // NO es un deliver exitoso (antes se imprimía ✓ sin mirar el resultado del rerun).
    const qa = await runDeliverRerunStage();
    const failures = actionableVerdicts(qa.agentRun.result);
    if (failures.length) {
      console.log('\n' + c.yellow(t('deliverRepairStage', failures.length, qa.repairPlanPath || 'qa/repair-plan.md')));
      console.log(c.dim('  ' + t('deliverRepairStop', deliverRerunCommandFromSummary(qa))));
      if (flags.strict) process.exit(1);
      return;
    }
    console.log(c.green('\n✓ ' + t('deliverDone') + '\n'));
    return;
  }

  console.log(c.bold(t('deliverQaStage')));
  const qa = await runDeliverQaStage();
  if (!qa?.agentRun) throw new Error(t('deliverQaIncomplete'));

  const failures = actionableVerdicts(qa.agentRun.result);
  const rerunCommand = deliverRerunCommandFromSummary(qa);
  console.log('\n' + (failures.length
    ? c.yellow(t('deliverRepairStage', failures.length, qa.repairPlanPath || 'qa/repair-plan.md'))
    : c.green(t('deliverRepairStage', 0, ''))));
  if (failures.length) {
    console.log(c.dim('  ' + t('deliverRepairStop', rerunCommand)));
    if (flags.strict) process.exit(1);
    return;
  }

  const ok = await runDeliverVerifyStage(qa.projectPath || projectPath);
  if (!ok) {
    console.log(c.yellow('! ' + t('deliverVerifyFailed')));
    return;
  }
  // Camino feliz: el QA de la etapa 1 ya PASÓ y nada cambió desde entonces, así que NO se re-ejecuta el
  // agente QA (evita doble gasto de IA — regla de CLAUDE.md — y que un 2º bring-up flaky vuelva error un
  // deliver ya exitoso). El rerun solo tiene sentido tras aplicar reparaciones, vía `chalc deliver --rerun`.
  console.log(c.green('\n✓ ' + t('deliverDone') + '\n'));
}
