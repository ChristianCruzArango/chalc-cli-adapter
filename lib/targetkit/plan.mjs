// lib/targetkit/plan.mjs — la vista previa del plan de los targets (`chalc --dry-run`). Es texto de la
// CONSOLA, así que va en el idioma de la interfaz por t(); antes la etiqueta «método» y varias notas
// estaban fijas en español y copiadas en cada target (M-05).

import { t } from '../i18n.mjs';

// Ancho de la columna de etiqueta: «skill     », «método    », «manifest  »…
const LABEL_WIDTH = 10;

export const planLabel = (key) => t(key).padEnd(LABEL_WIDTH);
export const planNote = (key) => t(key);

// La línea de un método: id, su modo si no es el por defecto, y una nota opcional.
export const methodPlanLine = (method, note = '') =>
  `${planLabel('planMethod')}${method.id}${method.mode && method.mode !== 'default' ? ` (${method.mode})` : ''}${note ? `  ${note}` : ''}`;
