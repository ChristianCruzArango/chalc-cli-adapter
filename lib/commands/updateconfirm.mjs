// lib/commands/updateconfirm.mjs — confirmación POR skill de `chalc update` (S6): enseña qué archivos
// cambian y avisa de permisos/hooks en el frontmatter antes de vendorizar cambios upstream.
// Interactivo: pregunta. Sin terminal: solo aplica con `--yes`; si no, la skill queda omitida.

import { t } from '../i18n.mjs';

const MAX_LISTED = 20;   // tope por grupo: un árbol enorme no inunda la consola

function listLines(mark, files) {
  const shown = files.slice(0, MAX_LISTED).map((f) => `    ${mark} ${f}`);
  return files.length > MAX_LISTED ? [...shown, `    … +${files.length - MAX_LISTED}`] : shown;
}

export function makeSkillConfirm({ prompter = null, assumeYes = false, print = console.log } = {}) {
  return async ({ id, changes, risky = [] }) => {
    const { added, removed, modified } = changes;
    print(t('updateChanges', id, added.length, removed.length, modified.length));
    for (const line of [...listLines('+', added), ...listLines('-', removed), ...listLines('~', modified)]) print(line);
    if (risky.length) print(t('updateRisky', id, risky.join(', ')));
    if (prompter) return prompter.yesno(t('updateSkillQ', id), false);
    return assumeYes;
  };
}
