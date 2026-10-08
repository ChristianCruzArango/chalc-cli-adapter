// lib/debate/prompts.mjs — qué se le dice a cada participante (spec 014, R8, R9, R17, R21, R31).
// Responsabilidad ÚNICA: componer el prompt de una llamada del debate. Razón de cambio: qué información
// recibe un participante.
//
// Dos decisiones de esta capa sostienen requisitos de la spec:
//   · R9 — el material que viaja NUNCA nombra al otro modelo ni a su proveedor. Un modelo que sabe que
//     le responde uno "más grande" cede sin argumento, y si reconoce su propia firma se da la razón.
//     Aquí solo hay "tu turno anterior" y "la otra parte".
//   · R31 — el último turno de cada lado viaja íntegro (el razonamiento completo convence o no
//     convence; el resumen solo transmite la conclusión), y las rondas anteriores condensadas a lo
//     que el parser ya extrajo. Sin eso, cada ronda re-paga todo el debate anterior.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { languageName } from '../i18n.mjs';
import { inject } from '../promptkit.mjs';
import { ratifyFormatBlock, synthesisFormatBlock, turnFormatBlock } from './sections.mjs';

// A partir de aquí, repetir la idea en cada llamada cuesta más que resumirla una vez (R35). Medido:
// con un documento de ~10.000 caracteres, la idea repetida es el 57 % de toda la entrada del debate.
// Por debajo del umbral, el resumen costaría más que el texto que ahorra.
export const BRIEF_THRESHOLD = 1500;

/** ¿Merece la pena comprimir esta idea antes de debatirla? (R35) */
export function needsBrief(idea, threshold = BRIEF_THRESHOLD) {
  return String(idea || '').length > threshold;
}

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

const TEMPLATES = {
  proponent: 'debate-proponent.prompt.xml',
  challenger: 'debate-challenger.prompt.xml',
  clarify: 'debate-clarify.prompt.xml',
  brief: 'debate-brief.prompt.xml',
  synthesis: 'debate-synthesis.prompt.xml',
  ratify: 'debate-ratify.prompt.xml'
};

async function template(name) {
  return readFile(join(PROMPTS_DIR, TEMPLATES[name]), 'utf8');
}

const block = (tag, content) => (content ? `<${tag}>\n${content}\n</${tag}>` : '');

// Lo que el autor de la idea aclaró — y lo que dejó sin aclarar, que es igual de importante: un hueco
// declarado es un supuesto que nadie se inventa.
function answersBlock(questions = []) {
  if (!questions.length) return '';
  return block('answers_from_author', questions
    .map((q) => `- ${q.text} → ${q.answered ? q.answer : '(unanswered — do not assume it)'}`)
    .join('\n'));
}

// Los desacuerdos abiertos con SU número: es el que hay que citar en ===RESUELTOS=== para darlos por
// cerrados, y el mismo con el que se comprueba después (R12).
function openBlock(stillOpen = []) {
  if (!stillOpen.length) return '';
  return block('open_disagreements', stillOpen.map((d) => `D${d.n}: ${d.text}`).join('\n'));
}

// Rondas viejas: solo lo que se extrajo de ellas. "you"/"the other side", nunca quién es quién.
function condensed(turns, meId) {
  if (!turns.length) return '';
  const lines = turns.map((t) => {
    const who = t.by === meId ? 'you' : 'the other side';
    const parts = [
      ...t.agreements.map((x) => `  + ${x}`),
      ...t.disagreements.map((x) => `  - ${x}`)
    ];
    return [`round ${t.round} · ${who}:`, ...(parts.length ? parts : ['  (nothing extracted)'])].join('\n');
  });
  return block('earlier_rounds', lines.join('\n'));
}

// Reparte los turnos: el último de cada lado va entero, el resto condensado.
function split(turns = [], meId) {
  const lastOf = (pred) => [...turns].reverse().find(pred) || null;
  const mine = lastOf((t) => t.by === meId);
  const other = lastOf((t) => t.by !== meId);
  return { mine, other, older: turns.filter((t) => t !== mine && t !== other) };
}

/** El material del debate tal y como lo ve `meId`. Sin identidades: solo "tú" y "la otra parte". */
function debateMaterial(state, meId) {
  const { mine, other, older } = split(state.turns, meId);
  return [
    block('idea', state.idea),
    answersBlock(state.questions),
    openBlock(state.openDisagreements),
    condensed(older, meId),
    mine ? block('your_previous_turn', mine.raw) : '',
    other ? block('the_other_side', other.raw) : ''
  ].filter(Boolean).join('\n\n');
}

/** El turno de un participante: su postura manda la plantilla, el material va anonimizado (R8, R9). */
export async function buildTurnPrompt({ participant, state, lang }) {
  const system = inject(await template(participant.stance), {
    LANGUAGE: languageName(lang),
    TURN_FORMAT: turnFormatBlock()
  });
  return { system, user: debateMaterial(state, participant.id) };
}

/** La ronda de aclaración: solo la idea, y solo se piden preguntas (R17). */
export async function buildClarifyPrompt({ participant, state, lang }) {
  const system = inject(await template('clarify'), {
    LANGUAGE: languageName(lang),
    TURN_FORMAT: turnFormatBlock()
  });
  // El texto ÍNTEGRO, no el resumen: las preguntas salen de lo que el autor escribió, y un resumen
  // no puede echar de menos lo que ya se le quitó (R35).
  return { system, user: block('idea', state.ideaFull || state.idea) };
}

/** Comprimir la idea UNA vez para no repetirla en cada llamada (R35). */
export async function buildBriefPrompt({ idea, lang }) {
  const system = inject(await template('brief'), { LANGUAGE: languageName(lang) });
  return { system, user: block('document', idea) };
}

/**
 * La ratificación: el lado que NO escribió el informe lo revisa contra el debate (R46).
 *
 * Recibe su propio material del debate —el mismo con el que argumentó— y el informe. No se le dice
 * quién lo redactó: si supiera que lo escribió el otro modelo buscaría pelea, y si creyera que lo
 * escribió él lo aprobaría sin leerlo.
 */
export async function buildRatifyPrompt({ participant, state, report, lang }) {
  const system = inject(await template('ratify'), {
    LANGUAGE: languageName(lang),
    RATIFY_FORMAT: ratifyFormatBlock()
  });
  return { system, user: [debateMaterial(state, participant.id), block('consolidated_report', report)].join('\n\n') };
}

/**
 * La reescritura del acta incorporando las correcciones de quien la ratificó (R46).
 *
 * Se le devuelve el acta anterior y las correcciones: reescribir desde cero perdería lo que ya estaba
 * bien y costaría el doble.
 */
export async function buildRewritePrompt({ state, report, corrections, lang }) {
  const { system } = await buildSynthesisPrompt({ state, lang });
  const user = [
    block('previous_minutes', report),
    block('corrections_from_the_other_side', corrections.map((c) => `- ${c}`).join('\n')),
    'Rewrite the minutes applying EVERY correction above. Keep everything else as it was: what was',
    'already faithful does not improve by being rewritten. Same sections, same marks.'
  ].join('\n\n');
  return { system, user };
}

/** El acta: el debate entero, sin identidades, para quien no lo presenció (R21). */
export async function buildSynthesisPrompt({ state, lang }) {
  const system = inject(await template('synthesis'), {
    LANGUAGE: languageName(lang),
    SYNTHESIS_FORMAT: synthesisFormatBlock()
  });
  const turnBlocks = (state.turns || [])
    .map((t) => block(`turn_round_${t.round}_side_${t.by === 'a' ? '1' : '2'}`, t.raw))
    .join('\n\n');
  const user = [
    block('idea', state.idea),
    answersBlock(state.questions),
    openBlock(state.openDisagreements),
    (state.settledDisagreements || []).length
      ? block('settled_disagreements', state.settledDisagreements.map((d) => `D${d.n}: ${d.text} → ${d.why}`).join('\n'))
      : '',
    turnBlocks
  ].filter(Boolean).join('\n\n');
  return { system, user };
}
