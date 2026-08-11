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
const ENTRY = /^##[ \t]+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)[ \t]*·[ \t]*([0-9a-f]+)[ \t]*·[ \t]*([a-z][a-z0-9-]*)[ \t]*·[ \t]*(OK|FINDINGS:[ \t]*\d+)[ \t]*$/;

const NONE = { exists: false, date: 0, commit: '', role: '', ok: false, findings: 0 };

const headingsOf = (markdown) => String(markdown ?? '').split(/\r?\n/).filter((line) => /^##[^#]/.test(line));

// Una entrada a partir de su encabezado, o null si no cumple el formato.
//
// `FINDINGS: 0` es una contradicción del contrato: sin hallazgos, el veredicto es `OK`. Aceptar las
// dos formas dejaría el cierre a merced de cómo el modelo decidió redactarlo esta vez.
function parseEntry(heading) {
  const match = ENTRY.exec(heading);
  if (!match) return null;

  const [, iso, commit, role, verdict] = match;
  const findings = verdict === 'OK' ? 0 : Number(verdict.replace(/\D+/g, ''));
  if (verdict !== 'OK' && findings === 0) return null;

  return { date: Date.parse(iso), commit, role, ok: verdict === 'OK', findings };
}

// TODAS las entradas legibles. Con varios roles ya no basta la última: cada rol se cubre con la suya
// (spec 009, R8), y la del endurecedor no dice nada del revisor. Las que no se entienden se saltan —
// aquí no invalidan la lectura entera, porque una entrada rota de hace tres tareas no debe borrar la
// buena de hoy.
export const allReviews = (markdown) => headingsOf(markdown).map(parseEntry).filter(Boolean);

// La última entrada. Si la última línea `##` no cumple el formato, la lectura entera se invalida:
// rescatar la anterior cerraría la tarea con una revisión que miró otro código.
export function lastReview(markdown) {
  const headings = headingsOf(markdown);
  if (!headings.length) return { ...NONE };

  const entry = parseEntry(headings[headings.length - 1]);
  return entry ? { exists: true, ...entry } : { ...NONE };
}
