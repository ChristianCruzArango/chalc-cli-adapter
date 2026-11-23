// lessons.mjs — el portón que no aprueba deja huella (spec 036, R4). Responsabilidad ÚNICA: anotar en la memoria
// del proyecto qué reglas se incumplieron. Razón de cambio: qué aprende el proyecto de un portón en rojo.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Una regla incumplida una vez es un despiste; la misma regla una y otra vez, en una spec y en otra, es algo que
// el equipo no sabe. Aquí solo se cuenta: que una candidata pase a ser regla de todos lo decide el usuario.
// Anotar NUNCA cambia el resultado del portón: si la memoria falla, el portón sigue diciendo lo mismo.

/** Cuántas reglas se anotan, como mucho, por corrida. */
export const MAX_NOTED = 5;
const MAX_FILES = 5;

const failed = (stage) => !stage.skipped && (stage.ok === false || stage.blocked === true);

// Lo que una etapa fallida deja para anotar: una entrada por regla, o la propia etapa si no trae hallazgos.
function notesOf(stage) {
  const byRule = new Map();
  for (const finding of stage.findings || []) {
    if (!finding?.rule) continue;
    byRule.set(finding.rule, [...new Set([...(byRule.get(finding.rule) || []), finding.file].filter(Boolean))]);
  }
  if (!byRule.size) return [{ id: `stage:${stage.stage}`, files: [], stage: stage.stage }];
  return [...byRule].map(([rule, files]) => ({ id: rule, files: files.slice(0, MAX_FILES), stage: stage.stage }));
}

/** Anota en la memoria de `root` las reglas incumplidas de `stages`. Devuelve cuántas anotó; nunca lanza. */
export async function noteFailure(root, stages) {
  try {
    const notes = stages.filter(failed).flatMap(notesOf).slice(0, MAX_NOTED);
    if (!notes.length) return 0;
    const { remember } = await import('../../memory/lib/store.mjs');
    for (const note of notes) {
      await remember(root, { key: `gate:${note.id}`, kind: 'candidate', concepts: [], title: `gate: ${note.id}`, files: note.files, origin: { role: 'gate', stage: note.stage } });
    }
    return notes.length;
  } catch {
    return 0;
  }
}
