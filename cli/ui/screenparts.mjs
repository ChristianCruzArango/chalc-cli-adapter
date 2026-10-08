// cli/ui/screenparts.mjs — piezas de la TUI (ver screen.mjs): utilidades puras de texto y terminal, y
// el contenido de las dos filas vivas (estado y caja de entrada) a partir del estado `st` de la pantalla.

import { t } from '../../lib/i18n.mjs';
import { c, stripAnsi } from './render.mjs';

export const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const AT = (r, col = 1) => `\x1b[${r};${col}H`;
export const CLR = '\x1b[2K';
export const out = (s) => process.stdout.write(s);
export const cols = () => process.stdout.columns || 80;
export const rows = () => process.stdout.rows || 24;
export const viewportH = () => Math.max(1, rows() - 4);   // filas de lectura sobre la franja fija (4 filas)

// Envuelve una línea al ancho dado SIN contar las secuencias ANSI (colores). El estado de color no se
// arrastra entre filas envueltas (cosmético aceptable: cada fila arranca con el color por defecto).
export function wrapAnsi(line, width) {
  const s = String(line);
  if (width <= 0 || stripAnsi(s).length <= width) return [s];
  const rows_ = [];
  let cur = '';
  let visible = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\x1b') {
      const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (m) { cur += m[0]; i += m[0].length - 1; continue; }
    }
    cur += s[i];
    visible++;
    if (visible >= width) { rows_.push(cur); cur = ''; visible = 0; }
  }
  if (cur) rows_.push(cur);
  return rows_;
}

// Delta de scroll de un chunk de eventos de MOUSE en formato SGR (\x1b[<b;x;yM): rueda arriba (b=64)
// desplaza hacia el historial, rueda abajo (b=65) hacia el final; 3 filas por muesca como una terminal
// normal. Clicks y arrastres devuelven 0 (se ignoran: no son texto y no deben llegar al editor).
// null = el chunk NO es de mouse (sigue el flujo normal). Exportado puro para testearlo sin terminal.
export function wheelDelta(str) {
  const s = String(str);
  if (!s.startsWith('\x1b[<')) return null;
  let delta = 0;
  for (const m of s.matchAll(/\x1b\[<(\d+);\d+;\d+[Mm]/g)) {
    const b = Number(m[1]);
    if (b === 64) delta += 3;
    else if (b === 65) delta -= 3;
  }
  return delta;
}

// Comandos que coinciden con lo tecleado: al escribir "/" se sugieren todos; "/p" filtra a /plan…
// Exportado puro para poder testearlo sin terminal.
export function matchSlash(commands = [], buf = '') {
  if (!buf.startsWith('/')) return [];
  const token = buf.split(' ')[0].toLowerCase();
  return commands.filter((cmd) => cmd.cmd.startsWith(token));
}

// Filas envueltas de una lista de líneas al ancho actual (el resize re-envuelve gratis).
export function flatRows(src) {
  const w = cols();
  const rows_ = [];
  for (const l of src) for (const p of wrapAnsi(l, w)) rows_.push(p);
  return rows_;
}

// Una fila EXACTA de terminal: la franja viva no puede envolverse (rompería la aritmética de borrado).
export const clip = (line) => wrapAnsi(String(line), Math.max(10, cols() - 1))[0] ?? '';

// Fila de estado. En modo lectura: posición + aviso de mensajes nuevos (la caja se queda quieta y el
// usuario SABE que abajo pasó algo). En vivo: sugerencias de "/…" o el spinner "pensando…".
export function statusLine(st) {
  if (st.scrollOff > 0) {
    const bits = [c.yellow('▲') + c.dim(' ' + t('scrReading', st.scrollOff))];
    if (st.pendingNew) bits.push(c.yellow(t('scrNewMessages', st.pendingNew)));
    if (st.thinking) bits.push(c.cyan(FRAMES[st.frame]) + ' ' + c.dim(st.thinkLabel));
    return '  ' + bits.join(c.dim('   ·   '));
  }
  const hints = matchSlash(st.commands, st.buf);
  if (hints.length) return '  ' + hints.map((h) => c.cyan(h.cmd) + c.dim(' ' + h.desc)).join(c.dim('  ·  '));
  if (st.thinking) {
    const s = Math.floor((Date.now() - st.thinkStartedAt) / 1000);
    return '  ' + c.cyan(FRAMES[st.frame]) + ' ' + c.dim(st.thinkLabel) + (s >= 3 ? ' ' + c.dim(s + 's') : '');
  }
  return '';
}

// Contenido de la caja de entrada y columna (0-based, tras el prefijo) donde debe quedar el cursor.
// Si hay un chooser activo, la caja se convierte en el selector (←/→ mueve, Enter elige, ESC cancela).
export function inputLine(st) {
  if (st.chooser) {
    const opts = st.chooser.options.map((o, i) => (i === st.chooser.idx ? c.cyan(`❯ ${o}`) : c.dim(`  ${o}`))).join('   ');
    return { text: c.gray('│') + ' ' + opts + c.dim('   ←/→ · enter · esc'), col: 2 };
  }
  // Ventana deslizante: si el texto no cabe, se muestra el tramo que contiene el cursor.
  const { buf, cur } = st;
  const w = Math.max(4, cols() - 6);
  const start = buf.length <= w ? 0 : Math.min(Math.max(0, cur - Math.floor(w * 0.8)), buf.length - w);
  const view = buf.slice(start, start + w);
  // El comando "/x" reconocido se pinta en cian: feedback inmediato de que existe y está bien escrito.
  let painted = view;
  if (view.startsWith('/') && matchSlash(st.commands, view).length) {
    const sp = view.indexOf(' ');
    painted = sp === -1 ? c.cyan(view) : c.cyan(view.slice(0, sp)) + view.slice(sp);
  }
  return { text: c.gray('│') + ' ' + c.cyan('› ') + painted, col: 4 + (cur - start) };
}
