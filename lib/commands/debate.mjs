// Comando `chalc debate` — dos modelos discuten una idea y dejan un informe (spec 014).
//
// Este archivo es el ADAPTADOR: argumentos, terminal, archivos y dinero. Las reglas del debate viven
// en lib/debate/engine.mjs, que no sabe que existe una IA — aquí se le inyecta `ask` (una llamada a
// un modelo) y `askUser` (una pregunta al humano). Esa frontera es la que permite probar el debate
// entero sin red y sin gastar un token.

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { t, lang } from '../i18n.mjs';
import { chat, loadConfig, isConfigured } from '../ai.mjs';
import { tokenSummary } from '../tokenmeter.mjs';
import { nextNumber } from '../specfolder.mjs';
import { plannedCalls, runDebate as debateLoop } from '../debate/engine.mjs';
import { resolveParticipants } from '../debate/participants.mjs';
import { buildBriefPrompt, buildClarifyPrompt, buildRatifyPrompt, buildRewritePrompt, buildSynthesisPrompt, buildTurnPrompt, needsBrief } from '../debate/prompts.mjs';
import { judge as runJudge } from '../debate/judge.mjs';
import { buildRecord, renderDebateLog, renderInforme } from '../debate/report.mjs';
import { unfence } from '../promptkit.mjs';
import { c, cleanPath, disp, dryRun, flags, interactive, positional, projectPath } from './context.mjs';
import { slugifyFeatureName } from './catalogstore.mjs';
import { makePrompter } from './prompter.mjs';
import { acquireUserStory } from './specgen.mjs';
import { configureAiDebate } from './ai.mjs';

const DEFAULT_ROUNDS = 3;
const ROUNDS_SIN_RETORNO = 3;   // a partir de aquí el debate se repite y solo suma coste
// Un turno es un argumento, no un documento (D9, R36). La salida cuesta unas cinco veces la entrada,
// así que el tope bajo no es tacañería: es la mitad de la factura. El acta sí necesita más aire.
const MAX_TOKENS_TURNO = 1200;
// El acta es EL entregable y lleva cada acuerdo explicado: con 2500 se cortaba a mitad de frase
// (medido: la llamada devolvía exactamente el tope). Es la única llamada que merece techo alto.
const MAX_TOKENS_ACTA = 8000;
// Ratificar es leer un informe entero y enumerar lo que falla: con el tope de un turno la
// respuesta se corta y el veredicto llega ilegible (medido: la llamada devolvía exactamente 1200).
const MAX_TOKENS_RATIFICACION = 2500;
const BUDGET_MINIMO = 1000;     // por debajo de esto el presupuesto no da ni para un turno
const SLUG_MAX = 40;

// El nombre de la carpeta: las primeras palabras de la idea, sin dejar un slug kilométrico.
function slugFor(idea) {
  const palabras = slugifyFeatureName(idea).split('-');
  let slug = '';
  for (const palabra of palabras) {
    if (slug && (slug + '-' + palabra).length > SLUG_MAX) break;
    slug = slug ? `${slug}-${palabra}` : palabra;
  }
  return slug || 'debate';
}

/**
 * Escribe el entregable y devuelve dónde quedó (R23, R26).
 *
 * Carpeta NUEVA siempre: dos debates sobre la misma idea son dos conversaciones distintas y la
 * segunda no puede pisar a la primera. `out` fuerza la ruta exacta que pida el usuario.
 */
export async function writeDebateOutput({ root, out, state, meta }) {
  let dir;
  if (out) {
    dir = resolve(cleanPath(String(out)));
  } else {
    const base = join(root, '.chalc', 'debate');
    dir = join(base, `${await nextNumber(base)}-${slugFor(state.idea || '')}`);
  }
  await mkdir(dir, { recursive: true });

  const files = [
    ['final.md', renderInforme(state, meta)],
    ['debate.md', renderDebateLog(state, meta)],
    ['debate.json', JSON.stringify(buildRecord(state, meta), null, 2) + '\n']
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
  if (!Number.isInteger(n) || n < BUDGET_MINIMO) throw new Error(t('debateBudgetInvalid', flags.budget));
  return n;
}

// Los dos lados, con la etiqueta que se enseña en pantalla.
function line(p) {
  return `${c.bold(p.model)} ${c.dim(`(${p.provider})`)}`;
}

export async function runDebate() {
  console.log('\n' + c.bold('⚙️  ' + t('debateTitle')) + (dryRun ? c.dim('  ' + t('dryrun')) : '') + '\n');
  console.log(c.dim('  ' + t('debateIntro')) + '\n');

  const rounds = resolveRounds();
  const budget = resolveBudget();
  if (rounds > ROUNDS_SIN_RETORNO) console.log(c.yellow('  ! ' + t('debateRoundsMany', rounds)) + '\n');

  const prompter = interactive ? makePrompter() : null;
  const cerrar = () => prompter?.close();

  try {
    // ── quién debate ────────────────────────────────────────────────────────────────────────────
    let cfg = await loadConfig();
    let participants = resolveParticipants(cfg);
    if (!participants.configured) {
      if (!prompter || !isConfigured(cfg)) { console.error(c.red('✗ ' + t('debateNotConfigured'))); process.exitCode = 1; return; }
      if (!await prompter.yesno(t('debateConfigNow'), true)) { console.error(c.red('✗ ' + t('debateNotConfigured'))); process.exitCode = 1; return; }
      await configureAiDebate(prompter);
      cfg = await loadConfig();
      participants = resolveParticipants(cfg);
      if (!participants.configured) { console.error(c.red('✗ ' + t('debateNotConfigured'))); process.exitCode = 1; return; }
    }

    console.log('  ' + t('debateVs', line(participants.a), line(participants.b)));
    for (const w of participants.warnings) {
      if (w === 'same-model') console.log(c.yellow('  ! ' + t('debateWarnSameModel')));
      if (w.startsWith('stale:')) console.log(c.yellow('  ! ' + t('debateWarnStale', t(w.endsWith('a') ? 'debateSideA' : 'debateSideB'))));
    }

    // ── la idea ─────────────────────────────────────────────────────────────────────────────────
    // Tres caminos, el mismo que ya usa spec-ia: como argumento, por el menú de fuentes (archivo
    // Word/PDF/md, Azure, Jira, Drive/URL o texto pegado) o por flags (`--doc`, `--url`, `--jira`,
    // `--azure`). `acquireUserStory(null)` es justo el camino de las flags, así que se llama SIEMPRE:
    // sin terminal, un `--doc informe.docx` tiene que funcionar igual.
    const idea = (positional.slice(1).join(' ') || await acquireUserStory(prompter)).trim();
    if (!idea) { console.error(c.red('✗ ' + t('debateNoIdea'))); process.exitCode = 1; return; }

    // ── el coste, ANTES de gastarlo ─────────────────────────────────────────────────────────────
    // La aclaración solo se paga si hay quien conteste (R34) y una idea larga se comprime una vez
    // (R35): las dos cosas cambian el número de llamadas, así que se deciden ANTES de anunciarlo,
    // porque un coste anunciado que no es el real no sirve para decidir (R37).
    const clarify = !!prompter || !!flags.questions;
    const brief = needsBrief(idea);
    const calls = plannedCalls({ rounds, judge: !!flags.judge, clarify, brief });
    console.log('\n  ' + c.dim(t('debateCostLine', calls, rounds) + (budget ? ' · ' + t('debateBudgetLine', budget) : '')));
    if (!clarify) console.log(c.dim('  ' + t('debateNoClarify')));
    if (dryRun) { console.log('\n' + c.dim('  ' + t('debateDryRun')) + '\n'); return; }
    if (prompter && !await prompter.yesno(t('debateCostQ', calls), true)) { console.log(c.dim('  ' + t('debateCancelled'))); return; }
    console.log('');

    // ── las dos inyecciones del motor ───────────────────────────────────────────────────────────
    const maxTokens = Number(cfg.cli?.maxTokens) || MAX_TOKENS_TURNO;
    // El acta y el dictamen los firma el "juez": un tercer modelo si está configurado, y si no el
    // participante A — en cuyo caso el informe dice que es juez y parte.
    const ask = async (req) => {
      if (req.system) return chat(participants.judge.cfg, { system: req.system, user: req.user, maxTokens });
      if (req.kind === 'synthesis') {
        const { system, user } = await buildSynthesisPrompt({ state: req.state, lang });
        return chat(participants.judge.cfg, { system, user, maxTokens: Math.max(maxTokens, MAX_TOKENS_ACTA) });
      }
      // La ratificación la responde el revisor con SU modelo: si la firmara el mismo que redactó, la
      // firma no valdría nada. La reescritura vuelve al redactor, que es quien sostiene el documento.
      if (req.kind === 'ratify') {
        const { system, user } = await buildRatifyPrompt({ participant: req.participant, state: req.state, informe: req.informe, lang });
        return chat(req.participant.cfg, { system, user, maxTokens: Math.max(maxTokens, MAX_TOKENS_RATIFICACION) });
      }
      if (req.kind === 'rewrite') {
        const { system, user } = await buildRewritePrompt({ state: req.state, informe: req.informe, correcciones: req.correcciones, lang });
        return chat(participants.judge.cfg, { system, user, maxTokens: Math.max(maxTokens, MAX_TOKENS_ACTA) });
      }
      const build = req.kind === 'clarify' ? buildClarifyPrompt : buildTurnPrompt;
      const { system, user } = await build({ participant: req.participant, state: req.state, lang });
      return chat(req.participant.cfg, { system, user, maxTokens });
    };

    // Sin terminal (o con --yes) NO hay askUser: el debate sigue y las preguntas quedan como dudas
    // abiertas del informe. Bloquearse esperando a un humano que no está es peor que asumir y decirlo.
    const askUser = prompter
      ? async (preguntas) => {
        console.log('\n  ' + c.cyan('?') + ' ' + t('debateAsking', preguntas.length));
        const out = [];
        for (const q of preguntas) out.push({ id: q.id, respuesta: await prompter.text('    ' + q.texto + ' ') });
        console.log('');
        return out;
      }
      : undefined;

    const onTurn = (turn, state) => {
      const marca = turn.declaraAcuerdo ? (turn.acuerdoJustificado ? c.green('✓') : c.yellow('~')) : ' ';
      const lado = t(turn.by === 'a' ? 'debateSideA' : 'debateSideB');
      console.log(`  ${marca} ${t('debateTurnLine', turn.round, lado)}  ${c.dim(t('debateOpenCount', state.desacuerdosAbiertos.length))}`);
    };

    // La idea larga se resume UNA vez y ese resumen es el que viaja en los nueve prompts; el texto
    // íntegro sigue yendo a la ronda de aclaración y al informe (R35).
    let ideaTurnos = idea;
    if (brief) {
      console.log(c.dim('  ' + t('debateBriefing')));
      const { system, user } = await buildBriefPrompt({ idea, lang });
      const resumen = unfence(await chat(participants.judge.cfg, { system, user, maxTokens: 800 }));
      if (resumen) { ideaTurnos = resumen; console.log(c.dim('  ' + t('debateBriefed', idea.length, resumen.length))); }
    }

    // El freno: se consulta entre turnos y mira el gasto REAL acumulado, no una estimación (R33).
    const shouldStop = budget ? () => tokenSummary().total >= budget : undefined;

    if (clarify) console.log(c.dim('  ' + t('debateClarifying')));
    const state = await debateLoop({
      idea: ideaTurnos, ideaFull: idea, participants: { a: participants.a, b: participants.b },
      rounds, ask, askUser, onTurn, clarify, shouldStop,
      // El acta la firma el "juez"; ratifica el otro lado. Por defecto el juez es A, así que revisa B.
      rapporteur: participants.judgeIsParticipant ? 'a' : ''
    });
    state.warnings = participants.warnings;
    state.briefed = brief;
    state.judgeIsParticipant = participants.judgeIsParticipant;

    // ── el dictamen opcional ────────────────────────────────────────────────────────────────────
    if (flags.judge && state.closedBy !== 'error') {
      console.log(c.dim('  ' + t('debateJudging')));
      try {
        state.judgment = await runJudge({ state, ask, lang });
      } catch (err) {
        console.log(c.yellow('  ! ' + (err?.message || err)));
      }
    }

    // ── el entregable ───────────────────────────────────────────────────────────────────────────
    const { dir } = await writeDebateOutput({
      root: projectPath, out: flags.out, state, meta: { generatedAt: new Date().toISOString() }
    });

    const CIERRES = { agreement: 'debateClosedAgreement', error: 'debateClosedError', budget: 'debateClosedBudget' };
    const cierre = CIERRES[state.closedBy] || 'debateClosedLimit';
    console.log('\n  ' + (state.closedBy === 'error' ? c.yellow('! ') : c.green('✓ ')) + t(cierre));
    // Que se vea en pantalla si el informe salió firmado por los dos o no: es la diferencia entre un
    // acuerdo y la versión de uno solo (R47, R48).
    const rat = state.ratification;
    const ladoRat = rat ? t(rat.by === 'a' ? 'debateSideA' : 'debateSideB') : '';
    if (rat?.conforme) console.log(c.green('  ✓ ' + t('debateRatified', ladoRat)));
    else if (rat?.aplicadas) console.log(c.green('  ✓ ' + t('debateRatifiedFixed', rat.correcciones.length)));
    else console.log(c.yellow('  ! ' + t('debateNotRatified')));
    if (state.error) console.log(c.yellow('  ! ' + t('debateFailed', state.error.round, t(state.error.by === 'a' ? 'debateSideA' : 'debateSideB'), state.error.message)));
    console.log(c.green('  ✓ ' + t('debateWritten', disp(dir))) + '\n');
    if (state.closedBy === 'error') process.exitCode = 1;
  } finally {
    cerrar();
  }
}
