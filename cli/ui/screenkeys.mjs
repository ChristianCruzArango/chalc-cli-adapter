// cli/ui/screenkeys.mjs — el teclado de la TUI (ver screen.mjs): un editor de línea PERSISTENTE que
// nunca se desconecta, así se puede escribir aunque el agente esté trabajando. Cada función devuelve
// `true` si se quedó con el chunk.

import { matchSlash, viewportH, wheelDelta } from './screenparts.mjs';
import { setBuf, setScroll, settleChooser, updateInput, updateStatus } from './screenview.mjs';

// MODO LECTURA: rueda del mouse y teclas de página funcionan SIEMPRE (también con chooser activo o
// mientras el agente piensa) — releer la conversación no interrumpe nada y la caja sigue fija.
function scrollKey(st, str) {
  const wd = wheelDelta(str);
  if (wd !== null) { if (wd) setScroll(st, st.scrollOff + wd); return true; }   // rueda; clicks se ignoran
  if (str === '\x1b[5~') { setScroll(st, st.scrollOff + viewportH() - 1); return true; }     // PgUp
  if (str === '\x1b[6~') { setScroll(st, st.scrollOff - (viewportH() - 1)); return true; }   // PgDn
  if (str === '\x1b[1;5H') { setScroll(st, Number.MAX_SAFE_INTEGER); return true; }         // Ctrl+Home → INICIO
  if (str === '\x1b[1;5F') { setScroll(st, 0); return true; }                               // Ctrl+End → en vivo
  return false;
}

// Chooser activo: las teclas van al selector, no al editor de línea (el resto se ignora mientras se elige).
function chooserKey(st, str) {
  const ch = st.chooser;
  if (str === '\x03') { st.onExit?.(); return; }                                          // Ctrl+C, siempre
  if (str === '\x1b') return settleChooser(st, null);                                     // ESC = cancelar
  if (str === '\x1b[C' || str === '\x1b[B') { ch.idx = (ch.idx + 1) % ch.options.length; return updateInput(st); }
  if (str === '\x1b[D' || str === '\x1b[A') { ch.idx = (ch.idx - 1 + ch.options.length) % ch.options.length; return updateInput(st); }
  if (str === '\r' || str === '\n') return settleChooser(st, ch.idx);
  const low = str.toLowerCase();
  if (low === 'y' || low === 's') return settleChooser(st, 0);                            // atajos de teclado
  if (low === 'n') return settleChooser(st, ch.options.length - 1);
}

// ESC "solo" (el chunk es únicamente \x1b): con TEXTO en la caja, la limpia (descarta lo escrito);
// con la caja vacía, interrumpe el turno en curso. Una secuencia (flechas: '\x1b[A') llega con más
// bytes en el mismo chunk y no cuenta como ESC.
function escapeKey(st) {
  if (!st.buf) { st.onEsc?.(); return; }
  st.buf = '';
  st.cur = 0;
  st.histIdx = -1;
  updateStatus(st);
  updateInput(st);
}

// Historial de envíos: ↑ hacia atrás, ↓ hacia delante (y al pasar el último, caja vacía).
function historyKey(st, up) {
  if (up) {
    if (!st.hist.length) return;
    st.histIdx = st.histIdx < 0 ? st.hist.length - 1 : Math.max(0, st.histIdx - 1);
    setBuf(st, st.hist[st.histIdx]);
    return;
  }
  if (st.histIdx < 0) return;
  st.histIdx++;
  if (st.histIdx >= st.hist.length) { st.histIdx = -1; setBuf(st, ''); return; }
  setBuf(st, st.hist[st.histIdx]);
}

// Edición de la caja: mover el cursor, saltar, borrar bajo el cursor y navegar el historial de envíos.
function editKey(st, str) {
  if (str === '\x1b[D') { st.cur = Math.max(0, st.cur - 1); updateInput(st); return true; }              // ←
  if (str === '\x1b[C') { st.cur = Math.min(st.buf.length, st.cur + 1); updateInput(st); return true; }  // →
  if (str === '\x1b[H' || str === '\x1b[1~') { st.cur = 0; updateInput(st); return true; }               // Home
  if (str === '\x1b[F' || str === '\x1b[4~') {                                                          // End
    if (st.scrollOff > 0) setScroll(st, 0);   // leyendo historial: End vuelve al final en vivo
    else { st.cur = st.buf.length; updateInput(st); }
    return true;
  }
  if (str === '\x1b[3~') { st.buf = st.buf.slice(0, st.cur) + st.buf.slice(st.cur + 1); updateStatus(st); updateInput(st); return true; }   // Supr
  if (str === '\x1b[A' || str === '\x1b[B') { historyKey(st, str === '\x1b[A'); return true; }
  return false;
}

// Envía la línea escrita: entra al historial y va a la shell, que decide el eco.
function submit(st) {
  const v = st.buf;
  st.buf = ''; st.cur = 0; st.histIdx = -1;
  if (!v.trim()) return;
  st.hist.push(v);
  if (st.hist.length > 100) st.hist.shift();
  st.onLine?.(v);
}

// Texto tecleado (o pegado): carácter a carácter, con Enter, Backspace y Tab (completa el comando).
function typeChars(st, str) {
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\x03') { st.onExit?.(); return; }                                       // Ctrl+C, siempre
    if (ch === '\r' || ch === '\n') { submit(st); continue; }
    if (ch === '\x7f' || ch === '\b') {                                                 // Backspace: borra ANTES del cursor
      if (st.cur > 0) { st.buf = st.buf.slice(0, st.cur - 1) + st.buf.slice(st.cur); st.cur--; }
      continue;
    }
    if (ch === '\t') {                                                                  // Tab: completa al primer comando sugerido
      const m = matchSlash(st.commands, st.buf);
      if (m.length) { st.buf = m[0].cmd + ' '; st.cur = st.buf.length; }
      continue;
    }
    if (ch === '\x1b') break;                                                           // secuencia de escape (flechas…): se ignora el resto
    if (ch >= ' ') { st.buf = st.buf.slice(0, st.cur) + ch + st.buf.slice(st.cur); st.cur++; }   // inserta EN el cursor
  }
  updateStatus(st);   // las sugerencias "/…" viven aquí y siguen cada tecla
  updateInput(st);
}

export function handleData(st, chunk) {
  const str = String(chunk);
  if (scrollKey(st, str)) return;
  if (st.chooser) { chooserKey(st, str); return; }
  if (str === '\x1b') { escapeKey(st); return; }
  if (editKey(st, str)) return;
  typeChars(st, str);
}
