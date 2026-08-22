// lib/debate/sections.mjs — el contrato de un turno de debate (spec 014, R10).
// Responsabilidad ÚNICA: qué secciones tiene un turno. Razón de cambio: el protocolo del turno.
//
// Las marcas NO se traducen. Son protocolo entre el modelo y el parser, no texto para el usuario:
// traducirlas obligaría a mantener dos parsers y un turno en inglés dejaría de leerse en una sesión
// en español. Lo que sí viaja en el idioma del usuario es el CONTENIDO, y eso lo fija `${LANGUAGE}`
// en la plantilla del prompt, igual que hace spec-ia.

// El orden es el que se le pide al modelo: primero argumenta, luego concede, luego objeta, y solo
// al final declara. Declarar antes de razonar invita a decidir antes de pensar.
export const TURN_SECTIONS = ['POSTURA', 'ACUERDOS', 'DESACUERDOS', 'RESUELTOS', 'PREGUNTAS_USUARIO', 'ESTADO'];

// Qué se espera dentro de cada marca. En inglés porque es instrucción para el modelo, como el resto
// de `lib/prompts/`.
const SECTION_HELP = {
  POSTURA: 'Your argument this turn. Full reasoning, not a conclusion.',
  ACUERDOS: 'Bullet list: points from the other side you accept. Empty is allowed.',
  DESACUERDOS: 'Bullet list: your objections to the OTHER SIDE position, one per line, each self-contained. Do NOT number them and do NOT prefix them with "D<n>:" — that reference belongs only in RESUELTOS. If one of your objections is already in the open disagreements you were given, do not repeat it here: argue it in POSTURA.',
  RESUELTOS: 'Bullet list: previously open disagreements you now consider settled, as "D<n>: <why it is settled>". Cite the D number you were given. No number, or no reason, means it is NOT settled.',
  PREGUNTAS_USUARIO: 'Bullet list: questions only the human owner of the idea can answer. Empty if none.',
  ESTADO: 'Exactly one line: "acuerdo: si" or "acuerdo: no".'
};

/**
 * El bloque de formato que se inyecta en las plantillas de prompt.
 *
 * Se GENERA desde `TURN_SECTIONS`: si mañana se añade o renombra una sección, el texto que ve el
 * modelo cambia solo. Escribirlo a mano en las plantillas sería garantizar que un día el parser lea
 * una marca que nadie le pidió al modelo — y ese fallo es silencioso: secciones vacías, no un error.
 */
export function turnFormatBlock() {
  return formatBlock(TURN_SECTIONS, SECTION_HELP);
}

// ---------- el acta final (R21) ----------
export const SYNTHESIS_SECTIONS = ['PROPUESTA', 'RESUMEN', 'ACUERDOS', 'RIESGOS', 'PROXIMOS_PASOS'];

const SYNTHESIS_HELP = {
  PROPUESTA: [
    'THE MAIN DELIVERABLE. Describe the idea AS IT STANDS AFTER THE DEBATE, in full, for someone who',
    'is going to build it and will not read the rest of this report. Not a summary of the discussion:',
    'the product itself, with everything the debate settled already folded in.',
    '',
    'Cover, with a "### " heading each and real detail under it:',
    '- Qué es y para quién: the product in a paragraph, and who uses it.',
    '- Cómo funciona: the main flows end to end, step by step, as they were agreed.',
    '- Reglas fijadas: the concrete rules the debate settled (money, cancellations, limits, timings),',
    '  written as rules someone can implement, not as opinions.',
    '- Anything the debate did NOT settle: write it inline as "[PENDIENTE: <the decision, and the',
    '  option each side defended>]", right at the point of the product it affects. Never as a separate',
    '  list at the end, and never resolved by you: the owner decides, but they decide seeing where the',
    '  hole is. Do not silently drop an open point either — a proposal that hides its gaps is worse',
    '  than one that shows them.',
    '- Por dónde empezar: the smallest version worth building first, if the debate touched it.',
    '',
    'Write 400-700 words. Everything here must come from the debate: invent nothing.'
  ].join('\n'),
  RESUMEN: 'Three to six lines: what was debated and where it ended up. Written for someone who did not watch it.',
  ACUERDOS: [
    'The body of the report. One numbered block per agreement, in this exact shape:',
    '',
    '### <short title of what was agreed>',
    'Qué se acordó: 2-4 lines explaining it properly — not a headline, the actual content and its scope.',
    'Lo que aportó el lado 1: what that side contributed, argued or conceded, in its own terms.',
    'Lo que aportó el lado 2: same for the other side.',
    'Qué implica: what this changes for the idea — what it forces, enables or rules out.',
    '',
    'Include everything both sides ended up holding, including what one side conceded WITH a reason.',
    'Be generous here: this is what the reader takes away and acts on.'
  ].join('\n'),
  RIESGOS: 'Bullet list: risks either side raised, each with the condition that triggers it.',
  PROXIMOS_PASOS: 'Bullet list: concrete next actions, in the order they should happen.'
};

export function synthesisFormatBlock() {
  return formatBlock(SYNTHESIS_SECTIONS, SYNTHESIS_HELP);
}

// ---------- la ratificación del informe (R46) ----------
export const RATIFY_SECTIONS = ['VEREDICTO', 'CORRECCIONES'];

const RATIFY_HELP = {
  VEREDICTO: 'Exactly one word: "conforme" if the report faithfully represents the debate, or "correcciones" if it does not.',
  CORRECCIONES: 'Empty when conforme. Otherwise a bullet list, one correction per line, each saying WHAT is wrong and WHAT it should say instead. Only faithfulness, never style.'
};

export function ratifyFormatBlock() {
  return formatBlock(RATIFY_SECTIONS, RATIFY_HELP);
}

// ---------- el dictamen opcional (R22) ----------
export const JUDGE_SECTIONS = ['VEREDICTO', 'PORQUE'];

const JUDGE_HELP = {
  VEREDICTO: 'Exactly one word: "1", "2" or "empate".',
  PORQUE: 'Why, in three lines at most. Which evidence or mechanism decides it.'
};

export function judgeFormatBlock() {
  return formatBlock(JUDGE_SECTIONS, JUDGE_HELP);
}

// El mismo formato para los tres contratos: una marca por sección y nada alrededor.
function formatBlock(names, help) {
  return [
    'Answer ONLY with these sections, in this exact order, each opened by its mark on its own line:',
    '',
    ...names.map((name) => `===${name}===\n${help[name]}`),
    '',
    'Do not add sections. Do not wrap the answer in code fences.'
  ].join('\n');
}
