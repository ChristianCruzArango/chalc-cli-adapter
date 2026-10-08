// cli/ui/screenview.mjs — el dibujo de la TUI (ver screen.mjs) sobre su estado `st`: la franja viva en
// el flujo normal, el MODO LECTURA con viewport propio y la impresión al historial.

import { stripControl } from '../../lib/termsafe.mjs';
import { c } from './render.mjs';
import { AT, CLR, clip, cols, flatRows, inputLine, out, rows, statusLine, viewportH, wrapAnsi } from './screenparts.mjs';

// TODA la conversación (incluido el banner) también en memoria: alimenta el MODO LECTURA. El tope es
// generoso a propósito: una sesión completa debe poder releerse de inicio a fin.
const MAX_LINES = 20000;

export function trimLines(st) {
  if (st.lines.length <= MAX_LINES) return;
  const cut = st.lines.length - MAX_LINES;
  st.lines.splice(0, cut);
  if (st.entryCount != null) st.entryCount = Math.max(0, st.entryCount - cut);
}

// ── Modo VIVO: la franja se dibuja EN EL FLUJO (con \n), así todo lo impreso entra al scrollback ──

// Dibuja la franja viva DEBAJO de lo último impreso: estado, borde, caja, borde. Deja el cursor
// parqueado en la fila de la caja (todo movimiento posterior es RELATIVO a esa posición).
export function drawUI(st) {
  const w = Math.max(2, cols() - 2);
  const inp = inputLine(st);
  out(clip(statusLine(st)) + '\n');
  out(c.gray('╭' + '─'.repeat(w) + '╮') + '\n');
  out(clip(inp.text) + '\n');
  out(c.gray('╰' + '─'.repeat(w) + '╯'));
  out('\x1b[1A\r' + (inp.col > 0 ? `\x1b[${inp.col}C` : ''));
  st.uiVisible = true;
}

// Borra la franja viva (cursor parqueado en la caja → 2 filas arriba está el estado) y deja el
// cursor donde debe continuar la transcripción. Idempotente si no hay franja dibujada.
export function eraseUI(st) {
  if (!st.uiVisible) return;
  out('\r\x1b[2A\x1b[0J');
  st.uiVisible = false;
}

// Reescribe SOLO la fila de estado (2 filas sobre la caja; vale en vivo y en modo lectura).
export function updateStatus(st) {
  if (!st.uiVisible) return;
  out('\x1b7' + '\x1b[2A\r\x1b[2K' + clip(statusLine(st)) + '\x1b8');
}

// Reescribe SOLO la caja (el cursor vive en su fila): borrar, pintar, reposicionar columna.
export function updateInput(st) {
  if (!st.uiVisible) return;
  const inp = inputLine(st);
  out('\r\x1b[2K' + clip(inp.text) + '\r' + (inp.col > 0 ? `\x1b[${inp.col}C` : ''));
}

// ── Modo LECTURA: viewport propio pintado EN SITIO (sin \n: nada extra entra al scrollback) ──

// Pinta el viewport (filas 1..H) con la ventana de `src` que termina en (final − offset).
function paintRows(src, offset) {
  const rows_ = flatRows(src);
  const H = viewportH();
  const end = Math.max(0, rows_.length - offset);
  const view = rows_.slice(Math.max(0, end - H), end);
  for (let i = 0; i < H; i++) out(AT(i + 1, 1) + CLR + (view[i] ?? ''));
}

// Pinta la franja fija en las 4 ÚLTIMAS filas de la pantalla y parquea el cursor en la caja.
function drawUIAt(st) {
  const w = Math.max(2, cols() - 2);
  const inp = inputLine(st);
  out(AT(rows() - 3, 1) + CLR + clip(statusLine(st)));
  out(AT(rows() - 2, 1) + CLR + c.gray('╭' + '─'.repeat(w) + '╮'));
  out(AT(rows() - 1, 1) + CLR + clip(inp.text));
  out(AT(rows(), 1) + CLR + c.gray('╰' + '─'.repeat(w) + '╯'));
  out(AT(rows() - 1, 1 + Math.max(0, inp.col)));
  st.uiVisible = true;
}

function renderScroll(st) {
  paintRows(st.lines, st.scrollOff);
  drawUIAt(st);
}

// Sale del modo lectura SIN romper el scrollback nativo: restaura la pantalla como estaba al entrar
// (la cola en vivo de ese momento) y lo llegado DURANTE la lectura se imprime por el flujo normal.
export function exitScroll(st) {
  st.scrollOff = 0;
  const entry = st.entryCount == null ? st.lines.length : st.entryCount;
  st.entryCount = null;
  const pending = st.lines.slice(entry);
  st.pendingNew = 0;
  paintRows(st.lines.slice(0, entry), 0);
  drawUIAt(st);
  if (pending.length) {
    eraseUI(st);
    out(pending.join('\n') + '\n');
    drawUI(st);
  }
}

// Mueve la vista de lectura (rueda/PgUp/PgDn/Ctrl+Home). Entra al modo solo cuando HAY historial que
// no cabe en pantalla; volver a 0 sale y muestra lo pendiente. La caja queda fija y usable siempre.
export function setScroll(st, n) {
  const max = Math.max(0, flatRows(st.lines).length - viewportH());
  const v = Math.max(0, Math.min(n, max));
  if (v > 0 && st.scrollOff === 0) {
    if (!max) return;                 // todo cabe en pantalla: no hay nada que desplazar
    st.entryCount = st.lines.length;
  }
  if (v === st.scrollOff) return;
  st.scrollOff = v;
  if (v === 0) exitScroll(st);
  else renderScroll(st);
}

// Imprime al historial. En vivo: al buffer normal de la terminal (scrollback real). En modo lectura:
// se acumula SIN mover la vista (el usuario está leyendo) y el aviso "↓ N mensajes nuevos" lo anuncia.
export function print(st, text = '') {
  // Último paso antes de la terminal: lo que no sea un estilo propio (cursor, borrado, OSC 52, texto
  // oculto) se quita aquí, venga del modelo, de una herramienta o de un servidor MCP.
  const added = stripControl(text, { keepStyles: true }).split('\n');
  st.lines.push(...added);
  trimLines(st);
  if (st.scrollOff > 0) {
    const w = cols();
    let addedRows = 0;
    for (const l of added) addedRows += wrapAnsi(l, w).length;
    st.scrollOff += addedRows;           // la ventana visible no se mueve
    st.pendingNew++;
    updateStatus(st);
    return;
  }
  eraseUI(st);
  out(String(text) + '\n');
  drawUI(st);
}

export function redraw(st) {
  if (st.scrollOff > 0) return renderScroll(st);
  eraseUI(st);
  drawUI(st);
}

// Fija el contenido de la caja (historial de envíos) dejando el cursor al final.
export function setBuf(st, v) {
  st.buf = String(v);
  st.cur = st.buf.length;
  updateStatus(st);
  updateInput(st);
}

// Resuelve el chooser activo y devuelve la caja a modo texto.
export function settleChooser(st, result) {
  const ch = st.chooser;
  st.chooser = null;
  updateInput(st);
  ch.resolve(result);
}
