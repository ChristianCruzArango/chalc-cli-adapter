// cli/shell/quality.mjs — el ciclo de calidad de la shell tras un turno o un plan: la revisión del
// rol reviewer (con una ronda de corrección opcional) y el portón de verificación con la toolchain real.

import { t } from '../../lib/i18n.mjs';
import { resetTokens } from '../../lib/tokenmeter.mjs';
import { flushTokenLog } from '../../lib/tokenlog.mjs';
import { startReview, logRound, logFixOrder, logFixResult, logVerify, REVIEW_REL } from '../engine/reviewfile.mjs';
import { runVerify, verifyAllowed, verifyCommand } from '../engine/verify.mjs';
import { frame } from '../prompts/text.mjs';
import { c, stepLine } from '../ui/render.mjs';
import { interruptible, modelOf, reportRoleTokens, runTurn } from './turns.mjs';

// La pasada del revisor sobre las rutas tocadas. Devuelve su resultado, o null si falló.
async function reviewerPass(shell, io, task, paths) {
  const shouldStop = interruptible(io, t('cliInterruptReview'));
  io.startThinking(t('cliReviewerWorking', modelOf(shell, 'reviewer')));
  resetTokens();
  try {
    const r = await shell.session.review(task, { paths, onStep: (s) => io.print(stepLine(s)), shouldStop });
    io.stopThinking();
    reportRoleTokens(shell, io, t('cliReviewerLabel', modelOf(shell, 'reviewer')));
    return r;
  } catch (e) {
    io.stopThinking();
    io.print(c.red(`✗ ${e.message}`));
    return null;
  } finally {
    io.setTurn?.(null);
    await flushTokenLog();   // el turno del revisor también cuesta: persistir al terminar
  }
}

// Hallazgos del revisor: se muestran y el usuario decide si el coder los corrige. La instrucción viaja
// al MODELO → inglés (MODEL_TEXT); los hallazgos van en el idioma del usuario.
async function offerFix(shell, io, projectPath, findings) {
  io.print(c.bold(t('cliReviewFindings')));
  for (const line of findings.split('\n')) io.print('  ' + c.yellow('│ ') + line);
  const pick = await io.choose(c.yellow(t('cliFixFindingsQ')), [t('cliOptYesFix'), t('cliOptNoLeave')]);
  if (pick !== 0) { io.print(c.dim(t('cliFindingsNoted'))); return; }
  const order = frame(shell.session.language).fixTask(findings);
  logFixOrder(projectPath, order);
  const fix = await runTurn(shell, io, order);
  logFixResult(projectPath, fix || {});
  io.print(c.dim(t('cliReviewLogAt', REVIEW_REL)));
  await runVerifyTurn(shell, io);
}

// Modo review (F2): el reviewer examina lo tocado en el último turno; si hay hallazgos, se ofrece UNA
// ronda de corrección del coder (acotada: el orquestador no re-revisa solo — el usuario decide).
export async function runReviewTurn(shell, io, task, paths) {
  if (!paths.length) { io.print(c.dim(t('cliNothingToReviewNoFiles'))); return; }
  const r = await reviewerPass(shell, io, task, paths);
  if (!r) return;
  if (r.empty) { io.print(c.dim(t('cliNothingToReviewNoChanges'))); return; }
  // Bitácora persistida del ciclo de calidad (.chalc/review.md): veredictos, órdenes de corrección
  // literales y resultados — la contraparte del plan.md, para auditar CÓMO se corrigió, no solo qué.
  const projectPath = shell.session.project?.projectPath;
  startReview(projectPath, task, { reviewer: modelOf(shell, 'reviewer') });
  logRound(projectPath, 1, { ok: r.ok, findings: r.findings });
  if (r.ok) { io.print(c.green(t('cliReviewOk'))); await runVerifyTurn(shell, io); return; }
  if (!r.findings) { io.print(c.yellow(t('cliReviewNoVerdict', r.error || t('cliReviewInterrupted')))); return; }
  await offerFix(shell, io, projectPath, r.findings);
}

// El comando de verificación, si hay uno y se puede correr. Sin comando no se inventa un portón,
// pero se DICE. Un build ejecuta código del repo: se rige por el perfil de confianza y pide
// confirmación EXPLÍCITA, también con /auto, como cualquier comando que ejecuta código (tools/trust.mjs).
async function verifyCommandToRun(shell, io, projectPath) {
  const cmd = verifyCommand(shell.session.project?.stacks || [], { projectPath });
  if (!cmd) {
    io.print(c.dim(t('cliVerifyNone')));
    if (projectPath) logVerify(projectPath, 0, { skipped: true, reason: 'sin comando de verificación' });
    return null;
  }
  if (!verifyAllowed(cmd, shell.session.allow || [])) {
    io.print(c.dim(t('cliVerifyNotAllowed', cmd)));
    logVerify(projectPath, 0, { skipped: true, command: cmd, reason: 'no permitido por el perfil de confianza' });
    return null;
  }
  if (await io.choose(c.yellow(t('cliVerifyRunQ', cmd)), [t('cliOptYesRun'), t('cliOptNoSkip')]) !== 0) {
    io.print(c.dim(t('cliVerifySkippedByUser', cmd)));
    logVerify(projectPath, 0, { skipped: true, command: cmd, reason: 'omitida por el usuario' });
    return null;
  }
  return cmd;
}

// Portón de VERIFICACIÓN (compila con la toolchain real del stack): el reviewer solo LEE — el compilador
// no perdona. Si falla, el usuario decide si los errores van al coder como ronda de corrección.
export async function runVerifyTurn(shell, io) {
  const { project } = shell.session;
  const cmd = await verifyCommandToRun(shell, io, project?.projectPath);
  if (!cmd) return;
  for (let round = 1; round <= 2; round++) {
    io.startThinking(t('cliVerifying', cmd));
    const v = await runVerify({ projectPath: project.projectPath, stacks: project?.stacks || [] });
    io.stopThinking();
    logVerify(project.projectPath, round, v);
    if (v.ok) { io.print(c.green(t('cliVerifyOk', cmd))); return; }
    io.print(c.red(t('cliVerifyFailed', cmd, v.timedOut)));
    for (const line of v.output.split('\n').slice(-14)) io.print('  ' + c.dim('│ ') + line);
    if (round === 2) { io.print(c.yellow(t('cliVerifyStillFailing'))); return; }
    const pick = await io.choose(c.yellow(t('cliPassErrorsQ')), [t('cliOptYesFix'), t('cliOptNoLeave')]);
    if (pick !== 0) { io.print(c.dim(t('cliErrorsNoted'))); return; }
    const order = frame(shell.session.language).verifyFixTask(v.command, v.output);
    logFixOrder(project.projectPath, order);
    const fix = await runTurn(shell, io, order);
    logFixResult(project.projectPath, fix || {});
  }
}
