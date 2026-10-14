// review.mjs — la bitácora de los roles de revisión (spec 008 R15/R16, spec 009 R8).
// Responsabilidad ÚNICA: leer las entradas de `.chalc/review.md`. Razón de cambio: el formato de esa
// bitácora.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// El encabezado es de formato FIJO y no localizado, aunque la prosa de debajo vaya en el idioma del
// spec. La razón es que quien lo escribe es un modelo de lenguaje: cuanto más estrecho el contrato,
// más detectable el incumplimiento. Y lo que no se entiende NO se interpreta — una entrada rota
// termina en `ask_human`, nunca en un cierre de tarea que nadie auditó.
//
// Puro: recibe el markdown, devuelve hechos. Quien lee el archivo es `snapshot.mjs`.

// `## <ISO-8601 Z> · <commit hex> · <rol> · OK` | `## <…> · <…> · <…> · FINDINGS: <n>`
//
// El rol lo añadió la spec 009 (R8) y no es decorativo: con varios roles de revisión, una entrada
// anónima daría por cubierto a cualquiera de ellos. Una entrada sin rol no se interpreta.
// Exportada para el tablero (spec 020, R18): lee la bitácora con esta MISMA gramática.
export const ENTRY = /^##[ \t]+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)[ \t]*·[ \t]*([0-9a-f]+)[ \t]*·[ \t]*([a-z][a-z0-9-]*)[ \t]*·[ \t]*(OK|FINDINGS:[ \t]*\d+)[ \t]*$/;

const NONE = { exists: false, date: 0, commit: '', role: '', ok: false, findings: 0 };

const headingsOf = (markdown) => String(markdown ?? '').split(/\r?\n/).filter((line) => /^##[^#]/.test(line));

// Una entrada a partir de su encabezado, o null si no cumple el formato.
//
// `FINDINGS: 0` es una contradicción del contrato: sin hallazgos, el veredicto es `OK`. Aceptar las
// dos formas dejaría el cierre a merced de cómo el modelo decidió redactarlo esta vez.
function parseEntry(heading, body = []) {
  const match = ENTRY.exec(heading);
  if (!match) return null;

  const [, iso, commit, role, verdict] = match;
  const findings = verdict === 'OK' ? 0 : Number(verdict.replace(/\D+/g, ''));
  if (verdict !== 'OK' && findings === 0) return null;

  return { date: Date.parse(iso), commit, role, ok: verdict === 'OK', findings, ...bodyFacts(body) };
}

// Una línea de checklist (spec 014, R28): `- A01 <nombre>: revisado — archivo:línea, …` o
// `- A02 <nombre>: no aplica — <motivo>`. Las palabras se aceptan en los dos idiomas del spec; el id
// de la categoría no se traduce.
const CHECK = /^\s*[-*]\s*(A\d{2}|MASVS-[A-Z]+)\b[^:\n]*:\s*(revisado|reviewed|no aplica|not applicable|n\/a)\s*(?:—|--|-)?\s*(.*)$/i;
const REVIEWED = /^(?:revisado|reviewed)$/i;

// Una regla aprendida (spec 015, R11): `Regla aprendida (<concepto>[; sinónimos: a, b]): <regla>`. La
// deja un rol cuando un hallazgo o un bug enseña algo que vale para otras specs; la memoria la
// captura al cerrar la tarea.
const LEARNED = /^\s*[-*]?\s*(?:regla aprendida|learned rule)\s*\(([^);]+)(?:;\s*(?:sin[oó]nimos|synonyms)\s*:\s*([^)]*))?\)\s*:\s*(.+)$/i;

// La confirmación de una regla entregada (spec 015, R17): `- Regla <id>: cumple — archivo:línea`,
// `no cumple — archivo:línea` o `no aplica — <motivo>`, en los dos idiomas del spec.
const CONFIRMED = /^\s*[-*]\s*(?:regla|rule)\s+([0-9a-f]{8})\s*:\s*(no cumple|cumple|no aplica|complies|violates|n\/a)\s*(?:—|--|-)?\s*(.*)$/i;
const NA = /^(?:no aplica|n\/a)$/i;

// La respuesta a un hallazgo de la pasada anterior del mismo rol (spec 017, R10):
// `- Hallazgo <n>: corregido | no corregido — archivo:línea` o `no aplica — <motivo>`, en los dos
// idiomas del spec. «no corregido» va ANTES que «corregido» en la alternativa: si no, se leería como
// corregido justo el hallazgo que sigue abierto.
const FOLLOWUP = /^\s*[-*]\s*(?:hallazgo|finding)\s+(\d+)\s*:\s*(no corregido|not fixed|corregido|fixed|no aplica|n\/a)\s*(?:—|--|-)?\s*(.*)$/i;
const FOLLOWUP_STATUS = { 'no corregido': 'not-fixed', 'not fixed': 'not-fixed', corregido: 'fixed', fixed: 'fixed' };

const followupOf = (line) => {
  const m = FOLLOWUP.exec(line);
  if (!m) return null;
  const [, n, word, rest] = m;
  const status = FOLLOWUP_STATUS[word.toLowerCase()];
  return [Number(n), status ? { status, refs: rest.match(/[\w./\\-]+:\d+/g) || [] } : { status: 'na', reason: rest.trim() }];
};

// Lo que el revisor dice de un requisito de la tarea (spec 019, R4): `- R<n>: cumple | no cumple —
// archivo:línea` o `no aplica — <motivo>`, en los dos idiomas. «no cumple» va antes que «cumple».
const REQUIREMENT = /^\s*[-*]\s*(R\d+)\s*:\s*(no cumple|cumple|complies|violates|no aplica|n\/a)\s*(?:—|--|-)?\s*(.*?)\s*$/i;
const REQUIREMENT_STATUS = { 'no cumple': 'violates', violates: 'violates', cumple: 'complies', complies: 'complies' };

const requirementOf = (line) => {
  const m = REQUIREMENT.exec(line);
  if (!m) return null;
  const [, id, word, rest] = m;
  const status = REQUIREMENT_STATUS[word.toLowerCase()];
  return [id.toUpperCase(), status ? { status, refs: rest.match(/[\w./\\-]+:\d+/g) || [] } : { status: 'na', reason: rest }];
};

// Un hallazgo numerado: `1. archivo:línea — problema`. Solo al principio de la línea.
const ITEM = /^\s*(\d+)\.\s+(.*?)\s*$/;
// Su continuación (spec 018, R12): una línea sangrada que no es una viñeta. Un modelo parte los hallazgos
// largos así, y quedarse con la primera línea dejaba al rol sin saber qué volver a mirar.
const CONTINUATION = /^\s+(?![-*])(\S.*?)\s*$/;

// Los hallazgos de un cuerpo, con sus continuaciones. Una línea en blanco o cualquier otra cosa los cierra.
function itemsOf(body) {
  const items = [];
  let open = null;
  for (const line of body) {
    const item = ITEM.exec(line);
    const more = open && CONTINUATION.exec(line);
    if (item) items.push(open = { n: Number(item[1]), text: item[2] });
    else if (more) open.text += ` ${more[1]}`;
    else open = null;
  }
  return items;
}

const confirmationOf = (line) => {
  const m = CONFIRMED.exec(line);
  if (!m) return null;
  const [, id, word, rest] = m;
  return NA.test(word)
    ? { id, status: 'na', reason: rest.trim() }
    : { id, status: /^(?:cumple|complies)$/i.test(word) ? 'complies' : 'violates', refs: rest.match(/[\w./\\-]+:\d+/g) || [] };
};

const learnedOf = (line) => {
  const m = LEARNED.exec(line);
  if (!m) return null;
  const synonyms = (m[2] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { concept: m[1].trim(), synonyms, text: m[3].trim() };
};

// Lo que dice el cuerpo de una entrada: su checklist, sus hallazgos numerados, las reglas que enseñó y
// lo que responde a los hallazgos anteriores. Lo lee todo rol; quién DEBE traer qué lo decide su
// contrato, no este lector.
function bodyFacts(body) {
  const checklist = {};
  const learned = body.map(learnedOf).filter(Boolean);
  const confirmations = Object.fromEntries(body.map(confirmationOf).filter(Boolean).map((c) => [c.id, c]));
  const items = itemsOf(body);
  const followups = Object.fromEntries(body.map(followupOf).filter(Boolean));
  const requirements = Object.fromEntries(body.map(requirementOf).filter(Boolean));
  for (const line of body) {
    const m = CHECK.exec(line);
    if (!m) continue;
    const [, id, word, rest] = m;
    checklist[id.toUpperCase()] = REVIEWED.test(word)
      ? { status: 'reviewed', refs: rest.match(/[\w./\\-]+:\d+/g) || [] }
      : { status: 'na', reason: rest.trim() };
  }
  return { checklist, numbered: items.length, items, learned, confirmations, followups, requirements };
}

// Cada encabezado `##` con las líneas que tiene debajo, hasta el siguiente.
function sectionsOf(markdown) {
  const sections = [];
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    if (/^##[^#]/.test(line)) sections.push({ heading: line, body: [] });
    else if (sections.length) sections.at(-1).body.push(line);
  }
  return sections;
}

// TODAS las entradas legibles. Con varios roles ya no basta la última: cada rol se cubre con la suya
// (spec 009, R8), y la del endurecedor no dice nada del revisor. Las que no se entienden se saltan —
// aquí no invalidan la lectura entera, porque una entrada rota de hace tres tareas no debe borrar la
// buena de hoy.
export const allReviews = (markdown) => sectionsOf(markdown).map((s) => parseEntry(s.heading, s.body)).filter(Boolean);

// La última entrada. Si la última línea `##` no cumple el formato, la lectura entera se invalida:
// rescatar la anterior cerraría la tarea con una revisión que miró otro código.
export function lastReview(markdown) {
  const headings = headingsOf(markdown);
  if (!headings.length) return { ...NONE };

  const entry = parseEntry(headings[headings.length - 1]);
  return entry ? { exists: true, ...entry } : { ...NONE };
}
