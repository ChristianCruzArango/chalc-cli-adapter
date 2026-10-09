// cli/ui/screen.mjs — UI estilo Claude Code: la transcripción vive en el buffer NORMAL de la terminal
// (todo queda en el scrollback nativo, también al salir) y la franja inferior (estado + caja de entrada)
// es FIJA: se borra y re-dibuja debajo de cada línea nueva. Encima, un MODO LECTURA con la caja siempre
// visible: la rueda del mouse (o PgUp) desplaza la conversación en un viewport propio mientras la caja
// sigue fija abajo; si el agente imprime algo mientras lees, el aviso "↓ N mensajes nuevos" lo dice sin
// moverte la vista, y End/Ctrl+End vuelve al vivo mostrando lo pendiente. Al salir del modo lectura la
// pantalla se restaura y lo pendiente se imprime por el flujo normal: el scrollback nativo no pierde nada.
// La caja está SIEMPRE viva: se puede seguir escribiendo mientras el agente piensa (las líneas se
// entregan por onLine y la shell decide si son respuesta de aprobación, siguiente tarea o cola).
// Sin dependencias: editor de línea en raw mode + mouse SGR + movimientos de cursor.
//
// Las piezas: screenparts (utilidades puras y filas vivas), screenview (dibujo y modo lectura) y
// screenkeys (teclado). Aquí solo el estado y la API pública.

import { t } from '../../lib/i18n.mjs';
import { c } from './render.mjs';
import { FRAMES, cols, out } from './screenparts.mjs';
import { drawUI, eraseUI, exitScroll, print, redraw, updateInput, updateStatus } from './screenview.mjs';
import { handleData } from './screenkeys.mjs';

export { wrapAnsi, wheelDelta, matchSlash } from './screenparts.mjs';

function initialState({ onExit, onEsc, commands }) {
  return {
    onExit, onEsc, commands,
    buf: '',
    cur: 0,              // posición del cursor DENTRO de buf (editable con ←/→/Home/End/Supr)
    hist: [],            // historial de instrucciones enviadas (↑/↓ navega)
    histIdx: -1,         // -1 = no está navegando el historial
    onLine: null,        // callback por línea (SIEMPRE activo; la shell enruta)
    chooser: null,       // selector activo { options, idx, resolve } — toma la caja de entrada
    thinking: false, thinkLabel: '', thinkStartedAt: 0, frame: 0, timer: null,
    uiVisible: false,    // ¿la franja viva (estado + caja) está dibujada?
    lines: [],           // la conversación en memoria, para el modo lectura
    scrollOff: 0,        // filas envueltas desplazadas desde el final (0 = en vivo)
    pendingNew: 0,       // mensajes llegados MIENTRAS se lee (para el aviso "↓ N mensajes nuevos")
    entryCount: null,    // cuántas líneas había al ENTRAR al modo lectura (para restaurar sin huecos)
    pasted: false,       // ¿la caja contiene texto pegado? (una línea pegada no responde aprobaciones)
    pasteBuf: null,      // pegado en curso (bracketed paste), hasta su marcador de cierre
    escTimer: null       // ESC suelto en espera: puede ser el inicio de una secuencia partida
  };
}

// Mouse en modo SGR: la rueda controla el modo lectura con la caja fija (sin esto, la rueda movería el
// viewport nativo y la caja se iría de pantalla). Seleccionar texto: Shift+arrastre. El banner se
// imprime al buffer normal (y a `lines`): queda arriba en el historial, como una línea más.
// Bracketed paste (`?2004`): lo pegado llega marcado y se trata como un bloque (screenkeys, V-07).
// Lo que deja la terminal como estaba: mouse y bracketed paste apagados, cursor visible y sin raw mode.
// Síncrono: también corre en `process.on('exit')`, donde nada asíncrono llega a completarse (O-03).
function restoreTerminal() {
  out('\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?25h');
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch { /* ya restaurado */ }
}

function open(st, header, listeners) {
  out('\x1b[?1000h\x1b[?1006h\x1b[?2004h');
  // Una excepción en un timer o una señal terminan el proceso sin pasar por close(): sin esto la
  // terminal quedaba en raw mode, con el ratón capturado y el cursor oculto.
  process.on('exit', restoreTerminal);
  for (const line of header) { st.lines.push(line); out(line + '\n'); }
  const sep = c.gray('─'.repeat(Math.max(2, cols() - 1)));
  st.lines.push(sep);
  out(sep + '\n');
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', listeners.data);
  process.stdout.on('resize', listeners.resize);
  drawUI(st);
}

function close(st, listeners) {
  if (st.timer) { clearInterval(st.timer); st.timer = null; }
  if (st.escTimer) { clearTimeout(st.escTimer); st.escTimer = null; }
  process.stdin.off('data', listeners.data);
  process.stdout.off('resize', listeners.resize);
  process.off('exit', restoreTerminal);
  if (st.scrollOff > 0) exitScroll(st); // salir leyendo no pierde lo pendiente: se imprime al flujo
  // Se borra SOLO la franja viva: la transcripción ya vive en el buffer normal de la terminal,
  // así que la conversación completa queda en el scroll nativo después de salir.
  eraseUI(st);
  restoreTerminal();
  process.stdin.pause();
}

// header: líneas del banner (título CHALC + info) — se imprimen UNA vez al abrir y viven en el
// historial como cualquier línea (suben con el scroll; la conversación manda, no el marco).
// onExit: Ctrl+C en CUALQUIER momento (en raw mode no hay SIGINT: llega como \x03 y se captura aquí).
// onEsc: tecla ESC sola (interrumpir el turno en curso). Las flechas llegan como '\x1b[X' y NO disparan onEsc.
// commands: [{ cmd, desc }] — al teclear "/" se muestran como sugerencias en la fila de estado y Tab completa.
export function createScreen({ header = [], onExit, onEsc, commands = [] } = {}) {
  const st = initialState({ onExit, onEsc, commands });
  const listeners = { data: (chunk) => handleData(st, chunk), resize: () => redraw(st) };
  const tick = () => { st.frame = (st.frame + 1) % FRAMES.length; updateStatus(st); };
  return {
    open: () => open(st, header, listeners),
    print: (text) => print(st, text),
    // La shell registra aquí su enrutador de líneas (aprobación / tarea / cola).
    setOnLine(fn) { st.onLine = fn; },
    // Selector en la caja de entrada: imprime la pregunta al historial y convierte la caja en un chooser
    // ←/→ + Enter (con atajos y/s/n). Resuelve el índice elegido, o null si se cancela con ESC.
    choose(question, options) {
      if (question) print(st, question);
      return new Promise((resolve) => {
        st.chooser = { options: options.map(String), idx: 0, resolve };
        updateInput(st);
      });
    },
    startThinking(label = t('cliThinking')) {
      st.thinking = true; st.thinkLabel = label; st.thinkStartedAt = Date.now();
      if (!st.timer) { st.timer = setInterval(tick, 250); st.timer.unref?.(); }
      updateStatus(st);
    },
    stopThinking() {
      st.thinking = false;
      if (st.timer) { clearInterval(st.timer); st.timer = null; }
      updateStatus(st);
    },
    close: () => close(st, listeners)
  };
}
