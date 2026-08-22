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
function notes(state, acta = {}) {
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
  if (r?.conforme) out.push(`- ${t('debateReportRatified', sideLabel(r.by))}`);
  else if (r?.aplicadas) out.push(`- ${t('debateReportRatifiedFixed', sideLabel(r.by), r.correcciones.length)}`);
  else out.push(`- ${t('debateReportNotRatified')}`);
  // Un acta que empieza y no llega al final se quedó sin tokens de salida. Entregarla como si
  // estuviera entera sería esconder que faltan conclusiones (y el usuario ya la pagó).
  if ((acta.PROPUESTA || acta.RESUMEN) && !acta.PROXIMOS_PASOS) out.push(`- ${t('debateReportCut')}`);
  if (state.closedBy === 'budget') out.push(`- ${t('debateReportBudget')}`);
  if (state.closedBy === 'error' && state.error) {
    out.push(`- ${t('debateReportPartial')}`);
    out.push(`- ${t('debateFailed', state.error.round, sideLabel(state.error.by), state.error.message)}`);
  }
  return out.join('\n');
}

/** El informe en markdown: lo acordado, lo que sigue en disputa, y con qué se generó (R24). */
export function renderInforme(state, { generatedAt } = {}) {
  const acta = parseSections(state.synthesis || '', SYNTHESIS_SECTIONS);
  const p = state.participants || {};

  // Lo que quedó sin cerrar viaja DENTRO de la propuesta, marcado en el punto del producto al que
  // afecta (R42): el entregable es la idea en la que los dos coinciden, no el acta de una pelea.
  //
  // Esta lista solo aparece cuando NO hay propuesta —debate cortado por fallo o por presupuesto—,
  // porque entonces es lo único que queda de lo que estaba en disputa y callarlo sería entregar un
  // informe que parece completo. El registro numerado y auditable vive en debate.json (R43).
  const sinCerrar = acta.PROPUESTA ? '' : (state.desacuerdosAbiertos || []).map((d) => `- ${d.texto}`).join('\n');

  const preguntas = (state.questions || []).length
    ? state.questions.map((q) => `- **${q.texto}** → ${q.respondida ? q.respuesta : `_${t('debateReportNoAnswer')}_`}`).join('\n')
    : `_${t('debateReportNoQuestions')}_`;

  const dictamen = state.judgment
    ? (state.judgment.empate
      ? `${t('debateReportTie')}\n\n${(state.judgment.porque || []).map((x) => `> ${x}`).join('\n\n')}`
      : `${t('debateReportWinner', sideLabel(state.judgment.ganador))}\n\n${(state.judgment.porque || []).map((x) => `> ${x}`).join('\n\n')}`)
    : '';

  // Las secciones vacías se descartan; la cabecera no pasa por ese filtro para no perder por el
  // camino sus líneas en blanco — sin ellas el markdown pega el título con la cita y no la renderiza.
  const cabecera = [
    `# ${t('debateReportTitle')}`,
    '',
    `> ${generatedAt || ''} · ${t('debateVs', whoLine(p.a), whoLine(p.b))} · ` +
      `${t('debateReportRounds', state.roundsRun || 0, state.rounds || 0)} · ${t(CLOSED[state.closedBy] || 'debateClosedLimit')}`,
    ''
  ].join('\n');

  return [
    cabecera,
    section(t('debateReportIdea'), state.ideaFull || state.idea || ''),
    section(t('debateReportProposal'), acta.PROPUESTA),
    section(t('debateReportWho'), [
      `| | ${t('debateReportWho')} | |`,
      '|---|---|---|',
      `| **A** | ${whoLine(p.a)} | ${stanceLabel('proponent')} |`,
      `| **B** | ${whoLine(p.b)} | ${stanceLabel('challenger')} |`
    ].join('\n')),
    section(t('debateReportSummary'), acta.RESUMEN),
    section(t('debateReportDecisions'), acta.ACUERDOS),
    section(t('debateReportPending'), sinCerrar),
    section(t('debateReportRisks'), acta.RIESGOS),
    section(t('debateReportQuestions'), preguntas),
    section(t('debateReportNext'), acta.PROXIMOS_PASOS),
    section(t('debateReportJudgment'), dictamen),
    section(t('debateReportNotes'), notes(state, acta))
  ].filter(Boolean).join('\n');
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
  const p = state.participants || {};

  // Lo que cada turno movió: se deduce del propio registro (quién levantó qué y en qué ronda), sin
  // guardar nada aparte — dos fuentes para el mismo hecho acabarían discrepando.
  const movimiento = (turn) => {
    const abrio = (state.desacuerdosAbiertos || []).concat(state.desacuerdosResueltos || [])
      .filter((d) => d.by === turn.by && d.round === turn.round).map((d) => `D${d.n}`);
    const resolvio = (state.desacuerdosResueltos || [])
      .filter((d) => d.resueltoPor === turn.by && d.resueltoEn === turn.round).map((d) => `D${d.n}`);
    const partes = [];
    if (abrio.length) partes.push(t('debateLogOpened', abrio.join(', ')));
    if (resolvio.length) partes.push(t('debateLogSolved', resolvio.join(', ')));
    return partes.length ? partes.join(' · ') : t('debateLogNothing');
  };

  const turno = (turn) => {
    const quien = p[turn.by] ? whoLine(p[turn.by]) : sideLabel(turn.by);
    return [
      `## ${t('debateTurnLine', turn.round, sideLabel(turn.by))} · ${quien} · ${stanceLabel(turn.stance)}`,
      '',
      `_${movimiento(turn)}_`,
      '',
      turn.raw,
      ''
    ].join('\n');
  };

  const preguntas = (state.questions || []).length
    ? state.questions.map((q) => `- **${q.texto}** _(${q.pedidaPor.map(sideLabel).join(', ')})_ → ${q.respondida ? q.respuesta : `_${t('debateReportNoAnswer')}_`}`).join('\n')
    : `_${t('debateReportNoQuestions')}_`;

  const abiertos = (state.desacuerdosAbiertos || []).length
    ? state.desacuerdosAbiertos.map((d) => `- **D${d.n}** — ${d.texto}  \n  _${t('debateReportRaisedBy', sideLabel(d.by), d.round)}_`).join('\n')
    : `_${t('debateLogNone')}_`;

  const resueltos = (state.desacuerdosResueltos || []).length
    ? state.desacuerdosResueltos.map((d) => `- **D${d.n}** — ${d.texto}  \n  _${t('debateReportSettledBy', sideLabel(d.resueltoPor), d.resueltoEn)}_: ${d.porque}`).join('\n')
    : `_${t('debateLogNone')}_`;

  // Las correcciones LITERALES de quien ratificó: la prueba de que el informe pasó por sus manos y de
  // qué hizo falta cambiar para que lo firmara (R47).
  const r = state.ratification;
  const ratificacion = !r
    ? `_${t('debateReportNotRatified')}_`
    : [
      r.conforme
        ? t('debateReportRatified', sideLabel(r.by))
        : (r.aplicadas ? t('debateReportRatifiedFixed', sideLabel(r.by), r.correcciones.length) : t('debateReportNotRatified')),
      ...(r.correcciones || []).map((c) => `- ${c}`),
      r.error ? `_${r.error}_` : ''
    ].filter(Boolean).join('\n\n');

  return [
    `# ${t('debateLogTitle')}`,
    '',
    `> ${generatedAt || ''} · ${t('debateVs', whoLine(p.a), whoLine(p.b))} · ` +
      `${t('debateReportRounds', state.roundsRun || 0, state.rounds || 0)} · ${t(CLOSED[state.closedBy] || 'debateClosedLimit')}`,
    '',
    section(t('debateReportIdea'), state.ideaFull || state.idea || ''),
    section(t('debateLogQuestions'), preguntas),
    ...(state.turns || []).map(turno),
    section(t('debateLogLedger'), [
      `### ${t('debateLogStillOpen')}`, '', abiertos, '',
      `### ${t('debateLogSettled')}`, '', resueltos
    ].join('\n')),
    section(t('debateLogRatification'), ratificacion),
    section(t('debateLogSynthesis'), state.synthesis || `_${t('debateLogNoSynthesis')}_`)
  ].filter(Boolean).join('\n');
}

/** El debate como dato, para que otro comando pueda tomarlo sin re-parsear un markdown. */
export function buildRecord(state, { generatedAt } = {}) {
  const p = state.participants || {};
  const lado = (x) => (x ? { id: x.id, stance: x.stance, model: x.model, provider: x.provider } : null);
  return {
    version: 1,
    generatedAt: generatedAt || '',
    idea: state.ideaFull || state.idea || '',
    ideaBrief: state.briefed ? (state.idea || '') : '',
    participants: { a: lado(p.a), b: lado(p.b) },
    rounds: { max: state.rounds || 0, run: state.roundsRun || 0 },
    closedBy: state.closedBy || '',
    error: state.error || null,
    warnings: state.warnings || [],
    questions: state.questions || [],
    desacuerdos: { abiertos: state.desacuerdosAbiertos || [], resueltos: state.desacuerdosResueltos || [] },
    turns: (state.turns || []).map(({ round, by, stance, postura, acuerdos, desacuerdos, resueltos, preguntas, declaraAcuerdo, acuerdoJustificado }) =>
      ({ round, by, stance, postura, acuerdos, desacuerdos, resueltos, preguntas, declaraAcuerdo, acuerdoJustificado: !!acuerdoJustificado })),
    synthesis: state.synthesis || '',
    ratification: state.ratification || null,
    judgment: state.judgment || null
  };
}
