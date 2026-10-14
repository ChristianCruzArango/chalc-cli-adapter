// cli/shell/describeaction.mjs — lo que ve el humano al aprobar una acción del agente: una etiqueta de
// una línea (también para el estado de /agents) y un extracto ACOTADO de lo que se va a escribir
// (spec 022, R5). Sin el extracto, `write build.rs (120 bytes)` se aprobaba a ciegas.

import { t } from '../../lib/i18n.mjs';
import { stripControl } from '../../lib/termsafe.mjs';
import { truncate } from '../ui/render.mjs';

const MAX_LINES = 12;        // líneas del contenido de un write
const MAX_EDIT_LINES = 6;    // por lado (old / new) de un edit
const MAX_LINE_CHARS = 160;  // un minificado de una sola línea no inunda la terminal

const clip = (line) => (line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) + '…' : line);

// Las primeras `max` líneas de `text`, saneadas y recortadas, con `mark` delante; avisa de lo omitido.
function excerpt(text, mark, max) {
  const lines = stripControl(String(text ?? '')).split('\n');
  const shown = lines.slice(0, max).map((line) => `  ${mark} ${clip(line)}`);
  const hidden = lines.length - shown.length;
  return hidden > 0 ? [...shown, `  ${mark} ${t('cliPreviewMoreLines', hidden)}`] : shown;
}

// Etiqueta de una línea: herramienta, ruta y tamaño o comando.
export function describeAction(action) {
  const a = action.args || {};
  const p = a.path || a.file || a.filename || a.file_path || t('cliNoPath');
  if (action.tool === 'write') return `write${a.append ? ' (append)' : ''} ${p} (${String(a.content ?? a.text ?? '').length} bytes)`;
  if (action.tool === 'edit') return `edit ${p}`;
  if (action.tool === 'bash') return `bash: ${a.command || ''}`;
  if (String(action.tool || '').startsWith('mcp__')) {
    const [, server, ...rest] = action.tool.split('__');
    return `MCP ${server}/${rest.join('__')} ${truncate(a, 80)}`;
  }
  return `${action.tool} ${truncate(a, 80)}`;
}

// Extracto del contenido (write) o del par old → new (edit), o '' si la acción no escribe texto.
export function actionPreview(action) {
  const a = action.args || {};
  if (action.tool === 'write') return excerpt(a.content ?? a.text ?? '', '│', MAX_LINES).join('\n');
  if (action.tool === 'edit') return [...excerpt(a.old, '-', MAX_EDIT_LINES), ...excerpt(a.new, '+', MAX_EDIT_LINES)].join('\n');
  return '';
}
