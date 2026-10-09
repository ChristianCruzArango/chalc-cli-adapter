// Comando `chalc debate` — dos modelos discuten una idea y dejan un informe (spec 014).
//
// Este archivo es el ADAPTADOR: argumentos, terminal, archivos y dinero. Las reglas del debate viven
// en lib/debate/engine.mjs, que no sabe que existe una IA — aquí se le inyecta `ask` (una llamada a
// un modelo) y `askUser` (una pregunta al humano). Esa frontera es la que permite probar el debate
// entero sin red y sin gastar un token.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { t, lang } from '../i18n.mjs';
import { chat, loadConfig, isConfigured } from '../ai.mjs';
import { tokenSummary } from '../tokenmeter.mjs';
import { nextNumber } from '../specfolder.mjs';
import { plannedCalls, runDebate as debateLoop } from '../debate/engine.mjs';
import { resolveParticipants } from '../debate/participants.mjs';
import { buildBriefPrompt, buildClarifyPrompt, buildRatifyPrompt, buildRewritePrompt, buildSynthesisPrompt, buildTurnPrompt, needsBrief } from '../debate/prompts.mjs';
import { judge as runJudge } from '../debate/judge.mjs';
import { buildRecord, renderDebateLog, renderReport } from '../debate/report.mjs';
import { unfence } from '../promptkit.mjs';
import { c, cleanPath, disp, dryRun, flags, interactive, positional, projectPath } from './context.mjs';
import { slugifyFeatureName } from './catalogstore.mjs';
import { makePrompter } from './prompter.mjs';
import { acquireUserStory } from './storyinput.mjs';
import { configureAiDebate } from './aiteam.mjs';

const DEFAULT_ROUNDS = 3;
const ROUNDS_WITHOUT_RETURN = 3;   // a partir de aquí el debate se repite y solo suma coste
// Un turno es un argumento, no un documento (D9, R36). La salida cuesta unas cinco veces la entrada,
// así que el tope bajo no es tacañería: es la mitad de la factura. El acta sí necesita más aire.
const MAX_TOKENS_TURN = 1200;
// El acta es EL entregable y lleva cada acuerdo explicado: con 2500 se cortaba a mitad de frase
// (medido: la llamada devolvía exactamente el tope). Es la única llamada que merece techo alto.
const MAX_TOKENS_MINUTES = 8000;
// Ratificar es leer un informe entero y enumerar lo que falla: con el tope de un turno la
// respuesta se corta y el veredicto llega ilegible (medido: la llamada devolvía exactamente 1200).
const MAX_TOKENS_RATIFICATION = 2500;
const MIN_BUDGET = 1000;     // por debajo de esto el presupuesto no da ni para un turno
const SLUG_MAX = 40;

// El nombre de la carpeta: las primeras palabras de la idea, sin dejar un slug kilométrico.
function slugFor(idea) {
  const words = slugifyFeatureName(idea).split('-');
  let slug = '';
  for (const word of words) {
    if (slug && (slug + '-' + word).length > SLUG_MAX) break;
    slug = slug ? `${slug}-${word}` : word;
  }
  return slug || 'debate';
}

const OUTPUT_FILES = ['final.md', 'debate.md', 'debate.json'];

// La carpeta de `--out` la eligió el usuario: si ya guarda un debate, no se pisa sin `--force`.
// Se comprueba también ANTES de debatir, para no gastar tokens en un resultado que no se podrá guardar.
export function assertDebateOutFree(out, force = false) {
  if (!out || force) return;
  const dir = resolve(cleanPath(String(out)));
  if (OUTPUT_FILES.some((name) => existsSync(join(dir, name)))) throw new Error(t('debateOutExists', dir));
}

/**
 * Escribe el entregable y devuelve dónde quedó (R23, R26).
 *
 * Carpeta NUEVA siempre: dos debates sobre la misma idea son dos conversaciones distintas y la
 * segunda no puede pisar a la primera. `out` fuerza la ruta exacta que pida el usuario.
 */
export async function writeDebateOutput({ root, out, state, meta, force = false }) {
  let dir;
  if (out) {
    assertDebateOutFree(out, force);
    dir = resolve(cleanPath(String(out)));
  } else {
    const base = join(root, '.chalc', 'debate');
    dir = join(base, `${await nextNumber(base)}-${slugFor(state.idea || '')}`);
  }
  await mkdir(dir, { recursive: true });

  const files = [
    [OUTPUT_FILES[0], renderReport(state, meta)],
    [OUTPUT_FILES[1], renderDebateLog(state, meta)],
    [OUTPUT_FILES[2], JSON.stringify(buildRecord(state, meta), null, 2) + '\n']
  ];
  for (const [name, content] of files) await writeFile(join(dir, name), content, 'utf8');
  return { dir, files: files.map(([name]) => name) };
}

// El tope de rondas. Un valor imposible se rechaza ANTES de gastar nada (R15).
function resolveRounds() {
  if (flags.rounds === undefined) return DEFAULT_ROUNDS;
  const n = Number(flags.rounds);
  if (!Number.isInteger(n) || n < 1) throw new Error(t('debateRoundsInvalid', flags.rounds));
  return n;
}

// El presupuesto en tokens: el freno que habla en la unidad que se paga (R33).
function resolveBudget() {
  if (flags.budget === undefined) return 0;
  const n = Number(flags.budget);
  if (!Number.isInteger(n) || n < MIN_BUDGET) throw new Error(t('debateBudgetInvalid', flags.budget));
  return n;
}

// Los dos lados, con la etiqueta que se enseña en pantalla.
function line(p) {
  return `${c.bold(p.model)} ${c.dim(`(${p.provider})`)}`;
}

const notConfigured = () => { console.error(c.red('✗ ' + t('debateNotConfigured'))); process.exitCode = 1; return null; };

// Quién debate. Si falta configurarlo y hay a quién preguntar, se configura aquí mismo. Devuelve
// { cfg, participants }, o null (y el código de salida) si no se puede debatir.
async function resolveDebaters(prompter) {
  let cfg = await loadConfig();
  let participants = resolveParticipants(cfg);
  if (!participants.configured) {
    if (!prompter || !isConfigured(cfg)) return notConfigured();
    if (!await prompter.yesno(t('debateConfigNow'), true)) return notConfigured();
    await configureAiDebate(prompter);
    cfg = await loadConfig();
    participants = resolveParticipants(cfg);
    if (!participants.configured) return notConfigured();
  }
  console.log('  ' + t('debateVs', line(participants.a), line(participants.b)));
  for (const w of participants.warnings) {
    if (w === 'same-model') console.log(c.yellow('  ! ' + t('debateWarnSameModel')));
    if (w.startsWith('stale:')) console.log(c.yellow('  ! ' + t('debateWarnStale', t(w.endsWith('a') ? 'debateSideA' : 'debateSideB'))));
  }
  return { cfg, participants };
}

// Las dos inyecciones del motor. El acta y el dictamen los firma el "juez": un tercer modelo si está
// configurado, y si no el participante A — en cuyo caso el informe dice que es juez y parte.
function makeAsk(participants, maxTokens) {
  const judge = participants.judge.cfg;
  return async (req) => {
    if (req.system) return chat(judge, { system: req.system, user: req.user, maxTokens });
    if (req.kind === 'synthesis') {
      const { system, user } = await buildSynthesisPrompt({ state: req.state, lang });
      return chat(judge, { system, user, maxTokens: Math.max(maxTokens, MAX_TOKENS_MINUTES) });
    }
    // La ratificación la responde el revisor con SU modelo: si la firmara el mismo que redactó, la
    // firma no valdría nada. La reescritura vuelve al redactor, que es quien sostiene el documento.
    if (req.kind === 'ratify') {
      const { system, user } = await buildRatifyPrompt({ participant: req.participant, state: req.state, report: req.report, lang });
      return chat(req.participant.cfg, { system, user, maxTokens: Math.max(maxTokens, MAX_TOKENS_RATIFICATION) });
    }
    if (req.kind === 'rewrite') {
      const { system, user } = await buildRewritePrompt({ state: req.state, report: req.report, corrections: req.corrections, lang });
      return chat(judge, { system, user, maxTokens: Math.max(maxTokens, MAX_TOKENS_MINUTES) });
    }
    const build = req.kind === 'clarify' ? buildClarifyPrompt : buildTurnPrompt;
    const { system, user } = await build({ participant: req.participant, state: req.state, lang });
    return chat(req.participant.cfg, { system, user, maxTokens });
  };
}

// Sin terminal (o con --yes) NO hay askUser: el debate sigue y las preguntas quedan como dudas
// abiertas del informe. Bloquearse esperando a un humano que no está es peor que asumir y decirlo.
function makeAskUser(prompter) {
  if (!prompter) return undefined;
  return async (raisedQuestions) => {
    console.log('\n  ' + c.cyan('?') + ' ' + t('debateAsking', raisedQuestions.length));
    const out = [];
    for (const q of raisedQuestions) out.push({ id: q.id, answer: await prompter.text('    ' + q.text + ' ') });
    console.log('');
    return out;
  };
}

function onTurn(turn, state) {
  const mark = turn.claimsAgreement ? (turn.justifiedAgreement ? c.green('✓') : c.yellow('~')) : ' ';
  const side = t(turn.by === 'a' ? 'debateSideA' : 'debateSideB');
  console.log(`  ${mark} ${t('debateTurnLine', turn.round, side)}  ${c.dim(t('debateOpenCount', state.openDisagreements.length))}`);
}

// La idea larga se resume UNA vez y ese resumen es el que viaja en los nueve prompts; el texto
// íntegro sigue yendo a la ronda de aclaración y al informe (R35).
async function briefIdea(idea, judgeCfg) {
  console.log(c.dim('  ' + t('debateBriefing')));
  const { system, user } = await buildBriefPrompt({ idea, lang });
  const summary = unfence(await chat(judgeCfg, { system, user, maxTokens: 800 }));
  if (!summary) return idea;
  console.log(c.dim('  ' + t('debateBriefed', idea.length, summary.length)));
  return summary;
}

// El coste, ANTES de gastarlo. La aclaración solo se paga si hay quien conteste (R34) y una idea
// larga se comprime una vez (R35): las dos cosas cambian el número de llamadas, así que se deciden
// ANTES de anunciarlo, porque un coste anunciado que no es el real no sirve para decidir (R37).
// Devuelve si seguir.
async function announceCost(prompter, { rounds, budget, clarify, brief }) {
  const calls = plannedCalls({ rounds, judge: !!flags.judge, clarify, brief });
  console.log('\n  ' + c.dim(t('debateCostLine', calls, rounds) + (budget ? ' · ' + t('debateBudgetLine', budget) : '')));
  if (!clarify) console.log(c.dim('  ' + t('debateNoClarify')));
  if (dryRun) { console.log('\n' + c.dim('  ' + t('debateDryRun')) + '\n'); return false; }
  if (prompter && !await prompter.yesno(t('debateCostQ', calls), true)) { console.log(c.dim('  ' + t('debateCancelled'))); return false; }
  console.log('');
  return true;
}

// Cómo terminó y si el informe salió firmado por los dos o no: es la diferencia entre un acuerdo y
// la versión de uno solo (R47, R48).
function printOutcome(state, dir) {
  const CLOSINGS = { agreement: 'debateClosedAgreement', error: 'debateClosedError', budget: 'debateClosedBudget' };
  console.log('\n  ' + (state.closedBy === 'error' ? c.yellow('! ') : c.green('✓ ')) + t(CLOSINGS[state.closedBy] || 'debateClosedLimit'));
  const rat = state.ratification;
  const ratifyingSide = rat ? t(rat.by === 'a' ? 'debateSideA' : 'debateSideB') : '';
  if (rat?.agreed) console.log(c.green('  ✓ ' + t('debateRatified', ratifyingSide)));
  else if (rat?.applied) console.log(c.green('  ✓ ' + t('debateRatifiedFixed', rat.corrections.length)));
  else console.log(c.yellow('  ! ' + t('debateNotRatified')));
  if (state.error) console.log(c.yellow('  ! ' + t('debateFailed', state.error.round, t(state.error.by === 'a' ? 'debateSideA' : 'debateSideB'), state.error.message)));
  console.log(c.green('  ✓ ' + t('debateWritten', disp(dir))) + '\n');
}

// El debate en sí, el dictamen opcional y el entregable.
async function debateAndWrite({ idea, rounds, budget, clarify, brief, cfg, participants, prompter }) {
  const ask = makeAsk(participants, Number(cfg.cli?.maxTokens) || MAX_TOKENS_TURN);
  const turnIdea = brief ? await briefIdea(idea, participants.judge.cfg) : idea;
  // El freno: se consulta entre turnos y mira el gasto REAL acumulado, no una estimación (R33).
  const shouldStop = budget ? () => tokenSummary().total >= budget : undefined;
  if (clarify) console.log(c.dim('  ' + t('debateClarifying')));
  const state = await debateLoop({
    idea: turnIdea, ideaFull: idea, participants: { a: participants.a, b: participants.b },
    rounds, ask, askUser: makeAskUser(prompter), onTurn, clarify, shouldStop,
    // El acta la firma el "juez"; ratifica el otro lado. Por defecto el juez es A, así que revisa B.
    rapporteur: participants.judgeIsParticipant ? 'a' : ''
  });
  state.warnings = participants.warnings;
  state.briefed = brief;
  state.judgeIsParticipant = participants.judgeIsParticipant;
  if (flags.judge && state.closedBy !== 'error') {
    console.log(c.dim('  ' + t('debateJudging')));
    try { state.judgment = await runJudge({ state, ask, lang }); }
    catch (err) { console.log(c.yellow('  ! ' + (err?.message || err))); }
  }
  const { dir } = await writeDebateOutput({ root: projectPath, out: flags.out, force: !!flags.force, state, meta: { generatedAt: new Date().toISOString() } });
  printOutcome(state, dir);
  if (state.closedBy === 'error') process.exitCode = 1;
}

export async function runDebate() {
  console.log('\n' + c.bold('⚙️  ' + t('debateTitle')) + (dryRun ? c.dim('  ' + t('dryrun')) : '') + '\n');
  console.log(c.dim('  ' + t('debateIntro')) + '\n');
  assertDebateOutFree(flags.out, !!flags.force);
  const rounds = resolveRounds();
  const budget = resolveBudget();
  if (rounds > ROUNDS_WITHOUT_RETURN) console.log(c.yellow('  ! ' + t('debateRoundsMany', rounds)) + '\n');
  const prompter = interactive ? makePrompter() : null;
  try {
    const debaters = await resolveDebaters(prompter);
    if (!debaters) return;
    // La idea: como argumento, por el menú de fuentes (archivo Word/PDF/md, Azure, Jira, Drive/URL
    // o texto pegado) o por flags (`--doc`, `--url`, `--jira`, `--azure`). `acquireUserStory(null)`
    // es justo el camino de las flags, así que se llama SIEMPRE: sin terminal, un `--doc
    // informe.docx` tiene que funcionar igual.
    const idea = (positional.slice(1).join(' ') || await acquireUserStory(prompter)).trim();
    if (!idea) { console.error(c.red('✗ ' + t('debateNoIdea'))); process.exitCode = 1; return; }
    const clarify = !!prompter || !!flags.questions;
    const brief = needsBrief(idea);
    if (!await announceCost(prompter, { rounds, budget, clarify, brief })) return;
    await debateAndWrite({ idea, rounds, budget, clarify, brief, ...debaters, prompter });
  } finally {
    prompter?.close();
  }
}
