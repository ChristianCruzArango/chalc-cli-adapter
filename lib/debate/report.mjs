// lib/debate/report.mjs — el entregable del debate (spec 014, R21, R24, R25, R30).
// Responsabilidad ÚNICA: convertir el estado final en lo que el usuario se lleva.
// Razón de cambio: cómo se presenta el resultado.
//
// El informe se escribe alrededor de una idea: **el desacuerdo es información**. El acta que redacta
// el modelo cuenta la discusión, pero la lista de desacuerdos abiertos —con su número, quién los
// levantó y en qué ronda— la pone el motor, que no puede maquillarla. Si el acta se olvidara de una
// objeción, el informe la sigue enseñando.
//
// Aquí SÍ se dice quién es quién: el anonimato de R9 protege a los modelos entre ellos, no al lector.

import { t } from '../i18n.mjs';
import { parseSections } from '../promptkit.mjs';
import { SYNTHESIS_SECTIONS } from './sections.mjs';

const CLOSED = { agreement: 'debateClosedAgreement', limit: 'debateClosedLimit', error: 'debateClosedError', budget: 'debateClosedBudget' };

const sideLabel = (id) => t(id === 'a' ? 'debateSideA' : 'debateSideB');
const stanceLabel = (stance) => t(stance === 'proponent' ? 'debateStanceProponent' : 'debateStanceChallenger');

// Un participante en una línea: modelo, proveedor y qué papel le tocó.
function whoLine(p) {
  return p ? `${p.model} (${p.provider})` : '—';
}

const section = (title, body) => (body ? `## ${title}\n\n${body}\n` : '');

// Los avisos que el lector necesita para saber con qué se generó esto: dos lados con el mismo modelo,
// un participante que cayó al modelo base, o un dictamen firmado por quien también debatía.
function notes(state, minutes = {}) {
  const out = [];
  for (const w of state.warnings || []) {
    if (w === 'same-model') out.push(`- ${t('debateWarnSameModel')}`);
    if (w.startsWith('stale:')) out.push(`- ${t('debateWarnStale', sideLabel(w.slice(6)))}`);
  }
  if (state.judgment && state.judgeIsParticipant) out.push(`- ${t('debateWarnJudgeParty')}`);
  // Con qué material se debatió y por qué se cortó: sin esto, el lector no puede juzgar el informe.
  if (state.briefed) out.push(`- ${t('debateReportBriefed')}`);
  // "Los dos están de acuerdo con este informe" es una afirmación fuerte: solo se hace si el otro lado
  // lo revisó de verdad, y cuando no, se dice igual de claro (R47, R48).
  const r = state.ratification;
  if (r?.agreed) out.push(`- ${t('debateReportRatified', sideLabel(r.by))}`);
  else if (r?.applied) out.push(`- ${t('debateReportRatifiedFixed', sideLabel(r.by), r.corrections.length)}`);
  else out.push(`- ${t('debateReportNotRatified')}`);
  // Un acta que empieza y no llega al final se quedó sin tokens de salida. Entregarla como si
  // estuviera entera sería esconder que faltan conclusiones (y el usuario ya la pagó).
  if ((minutes.PROPUESTA || minutes.RESUMEN) && !minutes.PROXIMOS_PASOS) out.push(`- ${t('debateReportCut')}`);
  if (state.closedBy === 'budget') out.push(`- ${t('debateReportBudget')}`);
  if (state.closedBy === 'error' && state.error) {
    out.push(`- ${t('debateReportPartial')}`);
    out.push(`- ${t('debateFailed', state.error.round, sideLabel(state.error.by), state.error.message)}`);
  }
  return out.join('\n');
}

// Fecha, participantes, rondas y cómo se cerró: la cita bajo el título de los dos documentos.
function metaLine(state, generatedAt) {
  const p = state.participants || {};
  return `> ${generatedAt || ''} · ${t('debateVs', whoLine(p.a), whoLine(p.b))} · ` +
    `${t('debateReportRounds', state.roundsRun || 0, state.rounds || 0)} · ${t(CLOSED[state.closedBy] || 'debateClosedLimit')}`;
}

function judgmentText(judgment) {
  if (!judgment) return '';
  const head = judgment.tie ? t('debateReportTie') : t('debateReportWinner', sideLabel(judgment.winner));
  return `${head}\n\n${(judgment.why || []).map((x) => `> ${x}`).join('\n\n')}`;
}

// Las preguntas al autor con su respuesta; `withAskers` añade quién la pidió (para el registro).
function questionsText(questions, { withAskers = false } = {}) {
  if (!questions?.length) return `_${t('debateReportNoQuestions')}_`;
  return questions.map((q) => {
    const askers = withAskers ? ` _(${q.askedBy.map(sideLabel).join(', ')})_` : '';
    return `- **${q.text}**${askers} → ${q.answered ? q.answer : `_${t('debateReportNoAnswer')}_`}`;
  }).join('\n');
}

function whoTable(p) {
  return [
    `| | ${t('debateReportWho')} | |`,
    '|---|---|---|',
    `| **A** | ${whoLine(p.a)} | ${stanceLabel('proponent')} |`,
    `| **B** | ${whoLine(p.b)} | ${stanceLabel('challenger')} |`
  ].join('\n');
}

/** El informe en markdown: lo acordado, lo que sigue en disputa, y con qué se generó (R24). */
export function renderReport(state, { generatedAt } = {}) {
  const minutes = parseSections(state.synthesis || '', SYNTHESIS_SECTIONS);

  // Lo que quedó sin cerrar viaja DENTRO de la propuesta, marcado en el punto del producto al que
  // afecta (R42): el entregable es la idea en la que los dos coinciden, no el acta de una pelea.
  //
  // Esta lista solo aparece cuando NO hay propuesta —debate cortado por fallo o por presupuesto—,
  // porque entonces es lo único que queda de lo que estaba en disputa y callarlo sería entregar un
  // informe que parece completo. El registro numerado y auditable vive en debate.json (R43).
  const unsettled = minutes.PROPUESTA ? '' : (state.openDisagreements || []).map((d) => `- ${d.text}`).join('\n');

  // Las secciones vacías se descartan; la cabecera no pasa por ese filtro para no perder por el
  // camino sus líneas en blanco — sin ellas el markdown pega el título con la cita y no la renderiza.
  const header = [`# ${t('debateReportTitle')}`, '', metaLine(state, generatedAt), ''].join('\n');

  return [
    header,
    section(t('debateReportIdea'), state.ideaFull || state.idea || ''),
    section(t('debateReportProposal'), minutes.PROPUESTA),
    section(t('debateReportWho'), whoTable(state.participants || {})),
    section(t('debateReportSummary'), minutes.RESUMEN),
    section(t('debateReportDecisions'), minutes.ACUERDOS),
    section(t('debateReportPending'), unsettled),
    section(t('debateReportRisks'), minutes.RIESGOS),
    section(t('debateReportQuestions'), questionsText(state.questions)),
    section(t('debateReportNext'), minutes.PROXIMOS_PASOS),
    section(t('debateReportJudgment'), judgmentText(state.judgment)),
    section(t('debateReportNotes'), notes(state, minutes))
  ].filter(Boolean).join('\n');
}

// Lo que cada turno movió: se deduce del propio registro (quién levantó qué y en qué ronda), sin
// guardar nada aparte — dos fuentes para el mismo hecho acabarían discrepando.
function turnMoves(state, turn) {
  const opened = (state.openDisagreements || []).concat(state.settledDisagreements || [])
    .filter((d) => d.by === turn.by && d.round === turn.round).map((d) => `D${d.n}`);
  const settledNow = (state.settledDisagreements || [])
    .filter((d) => d.settledBy === turn.by && d.settledIn === turn.round).map((d) => `D${d.n}`);
  const parts = [];
  if (opened.length) parts.push(t('debateLogOpened', opened.join(', ')));
  if (settledNow.length) parts.push(t('debateLogSolved', settledNow.join(', ')));
  return parts.length ? parts.join(' · ') : t('debateLogNothing');
}

function turnBlock(state, turn) {
  const p = state.participants || {};
  const who = p[turn.by] ? whoLine(p[turn.by]) : sideLabel(turn.by);
  return [
    `## ${t('debateTurnLine', turn.round, sideLabel(turn.by))} · ${who} · ${stanceLabel(turn.stance)}`,
    '',
    `_${turnMoves(state, turn)}_`,
    '',
    turn.raw,
    ''
  ].join('\n');
}

// La contabilidad de desacuerdos: los que siguen abiertos y los resueltos, con quién y por qué.
function ledgerText(state) {
  const stillOpen = (state.openDisagreements || []).length
    ? state.openDisagreements.map((d) => `- **D${d.n}** — ${d.text}  \n  _${t('debateReportRaisedBy', sideLabel(d.by), d.round)}_`).join('\n')
    : `_${t('debateLogNone')}_`;
  const settled = (state.settledDisagreements || []).length
    ? state.settledDisagreements.map((d) => `- **D${d.n}** — ${d.text}  \n  _${t('debateReportSettledBy', sideLabel(d.settledBy), d.settledIn)}_: ${d.why}`).join('\n')
    : `_${t('debateLogNone')}_`;
  return [`### ${t('debateLogStillOpen')}`, '', stillOpen, '', `### ${t('debateLogSettled')}`, '', settled].join('\n');
}

// Las correcciones LITERALES de quien ratificó: la prueba de que el informe pasó por sus manos y de
// qué hizo falta cambiar para que lo firmara (R47).
function ratificationText(r) {
  if (!r) return `_${t('debateReportNotRatified')}_`;
  return [
    r.agreed
      ? t('debateReportRatified', sideLabel(r.by))
      : (r.applied ? t('debateReportRatifiedFixed', sideLabel(r.by), r.corrections.length) : t('debateReportNotRatified')),
    ...(r.corrections || []).map((c) => `- ${c}`),
    r.error ? `_${r.error}_` : ''
  ].filter(Boolean).join('\n\n');
}

/**
 * El debate ÍNTEGRO como evidencia (R25): la idea, quién debatió, las preguntas al autor, cada turno
 * completo con lo que abrió y resolvió, cómo terminó la contabilidad y el acta tal cual llegó.
 *
 * El informe es la conclusión; esto es la prueba. Aquí SÍ va la contabilidad numerada de desacuerdos
 * —la que se sacó del informe para que se leyera de un tirón (R42)—, porque es lo que permite
 * rastrear cualquier afirmación del informe hasta el turno donde se dijo.
 */
export function renderDebateLog(state, { generatedAt } = {}) {
  return [
    `# ${t('debateLogTitle')}`,
    '',
    metaLine(state, generatedAt),
    '',
    section(t('debateReportIdea'), state.ideaFull || state.idea || ''),
    section(t('debateLogQuestions'), questionsText(state.questions, { withAskers: true })),
    ...(state.turns || []).map((turn) => turnBlock(state, turn)),
    section(t('debateLogLedger'), ledgerText(state)),
    section(t('debateLogRatification'), ratificationText(state.ratification)),
    section(t('debateLogSynthesis'), state.synthesis || `_${t('debateLogNoSynthesis')}_`)
  ].filter(Boolean).join('\n');
}

// debate.json conserva el formato de su versión 1, con sus claves en español: es lo que otros comandos
// pueden haber guardado y leer. Dentro del código el dominio se nombra en inglés; aquí se traduce.
const v1Question = (q) => ({ id: q.id, texto: q.text, pedidaPor: q.askedBy, respuesta: q.answer, respondida: q.answered });
const v1Disagreement = (d) => ({
  n: d.n, texto: d.text, by: d.by, round: d.round,
  ...(d.settledIn !== undefined ? { resueltoEn: d.settledIn, resueltoPor: d.settledBy, porque: d.why } : {})
});
const v1Turn = (turn) => ({
  round: turn.round, by: turn.by, stance: turn.stance, postura: turn.position, acuerdos: turn.agreements,
  desacuerdos: turn.disagreements, resueltos: turn.settled, preguntas: turn.raisedQuestions,
  declaraAcuerdo: turn.claimsAgreement, acuerdoJustificado: !!turn.justifiedAgreement
});
const v1Ratification = (r) => r && ({
  by: r.by, veredicto: r.verdict, conforme: r.agreed, correcciones: r.corrections, aplicadas: r.applied,
  ...(r.message !== undefined ? { message: r.message } : {}), error: r.error
});
const v1Judgment = (j) => j && ({
  ganador: j.winner, empate: j.tie, pasadas: (j.past || []).map((p) => ({ ganador: p.winner, porque: p.why, raw: p.raw })), porque: j.why
});

/** El debate como dato, para que otro comando pueda tomarlo sin re-parsear un markdown. */
export function buildRecord(state, { generatedAt } = {}) {
  const p = state.participants || {};
  const side = (x) => (x ? { id: x.id, stance: x.stance, model: x.model, provider: x.provider } : null);
  return {
    version: 1,
    generatedAt: generatedAt || '',
    idea: state.ideaFull || state.idea || '',
    ideaBrief: state.briefed ? (state.idea || '') : '',
    participants: { a: side(p.a), b: side(p.b) },
    rounds: { max: state.rounds || 0, run: state.roundsRun || 0 },
    closedBy: state.closedBy || '',
    error: state.error || null,
    warnings: state.warnings || [],
    questions: (state.questions || []).map(v1Question),
    desacuerdos: { abiertos: (state.openDisagreements || []).map(v1Disagreement), resueltos: (state.settledDisagreements || []).map(v1Disagreement) },
    turns: (state.turns || []).map(v1Turn),
    synthesis: state.synthesis || '',
    ratification: v1Ratification(state.ratification) || null,
    judgment: v1Judgment(state.judgment) || null
  };
}
