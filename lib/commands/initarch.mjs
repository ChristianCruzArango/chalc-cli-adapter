// La decisión arquitectónica de `chalc init`: la propuesta del proyecto, la sugerencia de la IA (con
// sus preguntas al usuario) y la elección final, que siempre es del usuario.

import { resolve } from 'node:path';
import { t, lang } from '../i18n.mjs';
import { configForTask, isConfigured, loadConfig } from '../ai.mjs';
import { readDocument } from '../docread.mjs';
import { analyzeProjectProposal, archText, buildArchitectureDecision, localizeComplexity, localizeType, MANDATORY_DESIGN_PRINCIPLES, suggestArchitectures } from '../init.mjs';
import { analyzeArchitectureWithAi } from '../initai.mjs';
import { c, cleanPath, flags } from './context.mjs';
import { printAiLine } from './ai.mjs';

// 3) Propuesta: texto o documento (Word/PDF/MD/TXT) → reusa la ingesta de spec-ia.
export async function askProposal(prompter, projectName) {
  let proposal = String(flags.description || '').trim();
  if (flags.doc) proposal = await readDocument(resolve(cleanPath(String(flags.doc))));
  if (prompter && !proposal) {
    const sources = [
      { label: t('initCtxText'), value: 'text' },
      { label: t('initCtxFile'), value: 'file' }
    ];
    const source = sources[await prompter.select(t('initContextQ'), sources, 0)].value;
    if (source === 'file') proposal = await readDocument(resolve(cleanPath(await prompter.text(t('initFileQ')))));
    else proposal = await prompter.text(t('initProposalQ'));
  }
  return proposal || projectName;
}

// Las dudas del LLM se le PREGUNTAN al usuario (no se dejan pasar) y se re-analiza con las respuestas.
async function clarify(prompter, st, analyze) {
  if (!st.aiHint.clarifications?.length) return;
  if (!prompter) { console.log(c.dim('  ' + t('initAiPending', st.aiHint.clarifications.join(' · ')))); return; }
  console.log('\n  ' + c.bold(t('initAiClarifyHdr')) + c.dim('  ' + t('initAiClarifyHint')));
  for (const q of st.aiHint.clarifications) {
    const a = (await prompter.text(`  ${q}`)).trim();
    if (a) st.clarificationsQA.push({ q, a });
  }
  if (!st.clarificationsQA.length) return;
  st.proposal += '\n\n' + (lang === 'en' ? 'User clarifications' : 'Aclaraciones del usuario') + ':\n' + st.clarificationsQA.map((x) => `- ${x.q} → ${x.a}`).join('\n');
  console.log(c.dim('  ' + t('initAiReanalyzing')));
  st.aiHint = await analyze();
}

function printSuggestion(st) {
  const { aiHint, suggestions } = st;
  const idx = suggestions.findIndex((s) => s.id === aiHint.architectureId);
  if (idx >= 0) st.recommendedIndex = idx;
  const recLabel = archText(suggestions.find((s) => s.id === aiHint.architectureId)?.label) || aiHint.architectureId;
  console.log('\n' + c.bold(t('initAiSuggestion')) + c.dim(aiHint.source === 'fallback' ? '  ' + t('initAiFallback') : ''));
  console.log(`  ${t('initAiArch')}: ${c.bold(recLabel)}`);
  if (aiHint.reasoning) console.log(`  ${t('initAiWhy', aiHint.reasoning)}`);
  if (aiHint.ccr) console.log(c.dim('  ' + t('initAiCcr', aiHint.ccr.entries, aiHint.ccr.charsSaved)));
  console.log(c.dim('  ' + t('initHumanDecision')));
}

// 4b) IA por defecto (es la razón de ser de init): analiza la propuesta, PREGUNTA sus dudas al usuario
// y re-analiza con las respuestas. Usa modelo económico + CCR. --no-ai la desactiva. Si algo falla,
// se avisa y se sigue con el análisis determinista (y con lo que la IA ya hubiera dicho).
async function aiSuggestion(prompter, st) {
  const cfg = await loadConfig();
  if (!isConfigured(cfg)) { console.log(c.dim('  ' + t('initAiNotConf'))); return; }
  printAiLine(configForTask(cfg, 'qa'));   // init usa el modelo económico (perfil 'qa')
  console.log(c.dim('  ' + t('initAiAnalyzing')));
  const analyze = () => analyzeArchitectureWithAi({ cfg, stackId: st.stackId, proposal: st.proposal, principles: MANDATORY_DESIGN_PRINCIPLES, language: lang === 'en' ? 'English' : 'español' });
  try {
    st.aiHint = await analyze();
    await clarify(prompter, st, analyze);
    printSuggestion(st);
  } catch (e) { console.log(c.yellow('  ! ' + t('initAiFailed', e.message))); }
}

// Cómo se leyó la propuesta y la elección del usuario entre las arquitecturas sugeridas.
async function askArchitecture(prompter, st, analysis) {
  console.log('\n' + c.bold(t('initReadingHdr')));
  console.log(`  ${t('initTypeL')}: ${localizeType(analysis.typeKey)}`);
  console.log(`  ${t('initCxL')}: ${localizeComplexity(analysis.complexity)}`);
  console.log(`  ${t('initSignalsL')}: ${analysis.signals.length ? analysis.signals.join(', ') : t('initNoSignals')}`);
  if (analysis.missing.length) console.log(c.dim('  ' + t('initPending', analysis.missing.join(', '))));
  console.log(c.dim('\n  ' + t('initPrinciplesAlways') + '\n'));
  const idx = await prompter.select(t('initArchQ'), st.suggestions.map((item) => ({
    label: `${archText(item.label)}${item.recommended ? ' (' + t('initRecommended') + ')' : ''}${st.aiHint && st.aiHint.architectureId === item.id ? ' ★ IA' : ''} — ${archText(item.fit)}`
  })), st.recommendedIndex);
  return st.suggestions[idx].id;
}

// 4) Arquitectura: chalc sugiere (calibrada), el usuario decide. Devuelve la decisión completa.
export async function decideArchitecture(prompter, stackId, proposal) {
  const analysis = analyzeProjectProposal(proposal);
  const suggestions = suggestArchitectures(stackId, analysis);
  const st = { stackId, proposal, suggestions, aiHint: null, clarificationsQA: [], recommendedIndex: Math.max(0, suggestions.findIndex((item) => item.recommended)) };
  let architectureId = String(flags.architecture || '').trim();
  if (!architectureId && flags.ai !== false) await aiSuggestion(prompter, st);
  if (prompter && !architectureId) architectureId = await askArchitecture(prompter, st, analysis);
  if (!architectureId) architectureId = suggestions[st.recommendedIndex].id;
  return buildArchitectureDecision({ stack: stackId, proposal: st.proposal, architectureId, clarifications: st.clarificationsQA });
}
