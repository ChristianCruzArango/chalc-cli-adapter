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

import { c, stripAnsi } from './render.mjs';

// Envuelve una línea al ancho dado SIN contar las secuencias ANSI (colores). El estado de color no se
// arrastra entre filas envueltas (cosmético aceptable: cada fila arranca con el color por defecto).
export function wrapAnsi(line, width) {
  const s = String(line);
  if (width <= 0 || stripAnsi(s).length <= width) return [s];
  const rows = [];
  let cur = '';
  let visible = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\x1b') {
      const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (m) { cur += m[0]; i += m[0].length - 1; continue; }
    }
    cur += s[i];
    visible++;
    if (visible >= width) { rows.push(cur); cur = ''; visible = 0; }
  }
  if (cur) rows.push(cur);
  return rows;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const AT = (r, col = 1) => `\x1b[${r};${col}H`;
const CLR = '\x1b[2K';

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
  return commands.filter((c) => c.cmd.startsWith(token));
}

// header: líneas del banner (título CHALC + info) — se imprimen UNA vez al abrir y viven en el
// historial como cualquier línea (suben con el scroll; la conversación manda, no el marco).
// onExit: Ctrl+C en CUALQUIER momento (en raw mode no hay SIGINT: llega como \x03 y se captura aquí).
// onEsc: tecla ESC sola (interrumpir el turno en curso). Las flechas llegan como '\x1b[X' y NO disparan onEsc.
// commands: [{ cmd, desc }] — al teclear "/" se muestran como sugerencias en la fila de estado y Tab completa.
export function createScreen({ header = [], onExit, onEsc, commands = [] } = {}) {
  const out = (s) => process.stdout.write(s);
  const cols = () => process.stdout.columns || 80;
  const rows = () => process.stdout.rows || 24;
  const viewportH = () => Math.max(1, rows() - 4);   // filas de lectura sobre la franja fija (4 filas)

  let buf = '';
  let cur = 0;            // posición del cursor DENTRO de buf (editable con ←/→/Home/End/Supr)
  let hist = [];          // historial de instrucciones enviadas (↑/↓ navega)
  let histIdx = -1;       // -1 = no está navegando el historial
  let onLine = null;      // callback por línea (SIEMPRE activo; la shell enruta)
  let chooser = null;     // selector activo { options, idx, resolve } — toma la caja de entrada
  let thinking = false;
  let thinkLabel = '';
  let thinkStartedAt = 0;
  let frame = 0;
  let timer = null;
  let uiVisible = false;  // ¿la franja viva (estado + caja) está dibujada?

  // TODA la conversación (incluido el banner) también en memoria: alimenta el MODO LECTURA. El tope es
  // generoso a propósito: una sesión completa debe poder releerse de inicio a fin.
  const MAX_LINES = 20000;
  let lines = [];
  let scrollOff = 0;      // filas envueltas desplazadas desde el final (0 = en vivo)
  let pendingNew = 0;     // mensajes llegados MIENTRAS se lee (para el aviso "↓ N mensajes nuevos")
  let entryCount = null;  // cuántas líneas había al ENTRAR al modo lectura (para restaurar sin huecos)

  function trim() {
    if (lines.length <= MAX_LINES) return;
    const cut = lines.length - MAX_LINES;
    lines.splice(0, cut);
    if (entryCount != null) entryCount = Math.max(0, entryCount - cut);
  }

  // Filas envueltas de una lista de líneas al ancho actual (el resize re-envuelve gratis).
  function flatRows(src) {
    const w = cols();
    const rows_ = [];
    for (const l of src) for (const p of wrapAnsi(l, w)) rows_.push(p);
    return rows_;
  }

  // Una fila EXACTA de terminal: la franja viva no puede envolverse (rompería la aritmética de borrado).
  const clip = (line) => wrapAnsi(String(line), Math.max(10, cols() - 1))[0] ?? '';

  // Fila de estado. En modo lectura: posición + aviso de mensajes nuevos (la caja se queda quieta y el
  // usuario SABE que abajo pasó algo). En vivo: sugerencias de "/…" o el spinner "pensando…".
  function statusLine() {
    if (scrollOff > 0) {
      const bits = [c.yellow('▲') + c.dim(` historial (−${scrollOff}) · rueda/PgUp/PgDn · Ctrl+Home = inicio · End = en vivo`)];
      if (pendingNew) bits.push(c.yellow(`↓ ${pendingNew} mensaje${pendingNew === 1 ? '' : 's'} nuevo${pendingNew === 1 ? '' : 's'} · End para verlos`));
      if (thinking) bits.push(c.cyan(FRAMES[frame]) + ' ' + c.dim(thinkLabel));
      return '  ' + bits.join(c.dim('   ·   '));
    }
    const hints = matchSlash(commands, buf);
    if (hints.length) return '  ' + hints.map((h) => c.cyan(h.cmd) + c.dim(' ' + h.desc)).join(c.dim('  ·  '));
    if (thinking) {
      const s = Math.floor((Date.now() - thinkStartedAt) / 1000);
      return '  ' + c.cyan(FRAMES[frame]) + ' ' + c.dim(thinkLabel) + (s >= 3 ? ' ' + c.dim(s + 's') : '');
    }
    return '';
  }

  // Contenido de la caja de entrada y columna (0-based, tras el prefijo) donde debe quedar el cursor.
  // Si hay un chooser activo, la caja se convierte en el selector (←/→ mueve, Enter elige, ESC cancela).
  function inputLine() {
    if (chooser) {
      const opts = chooser.options.map((o, i) => (i === chooser.idx ? c.cyan(`❯ ${o}`) : c.dim(`  ${o}`))).join('   ');
      return { text: c.gray('│') + ' ' + opts + c.dim('   ←/→ · enter · esc'), col: 2 };
    }
    // Ventana deslizante: si el texto no cabe, se muestra el tramo que contiene el cursor.
    const w = Math.max(4, cols() - 6);
    const start = buf.length <= w ? 0 : Math.min(Math.max(0, cur - Math.floor(w * 0.8)), buf.length - w);
    const view = buf.slice(start, start + w);
    // El comando "/x" reconocido se pinta en cian: feedback inmediato de que existe y está bien escrito.
    let painted = view;
    if (view.startsWith('/') && matchSlash(commands, view).length) {
      const sp = view.indexOf(' ');
      painted = sp === -1 ? c.cyan(view) : c.cyan(view.slice(0, sp)) + view.slice(sp);
    }
    return { text: c.gray('│') + ' ' + c.cyan('› ') + painted, col: 4 + (cur - start) };
  }

  // ── Modo VIVO: la franja se dibuja EN EL FLUJO (con \n), así todo lo impreso entra al scrollback ──

  // Dibuja la franja viva DEBAJO de lo último impreso: estado, borde, caja, borde. Deja el cursor
  // parqueado en la fila de la caja (todo movimiento posterior es RELATIVO a esa posición).
  function drawUI() {
    const w = Math.max(2, cols() - 2);
    const inp = inputLine();
    out(clip(statusLine()) + '\n');
    out(c.gray('╭' + '─'.repeat(w) + '╮') + '\n');
    out(clip(inp.text) + '\n');
    out(c.gray('╰' + '─'.repeat(w) + '╯'));
    out('\x1b[1A\r' + (inp.col > 0 ? `\x1b[${inp.col}C` : ''));
    uiVisible = true;
  }

  // Borra la franja viva (cursor parqueado en la caja → 2 filas arriba está el estado) y deja el
  // cursor donde debe continuar la transcripción. Idempotente si no hay franja dibujada.
  function eraseUI() {
    if (!uiVisible) return;
    out('\r\x1b[2A\x1b[0J');
    uiVisible = false;
  }

  // Reescribe SOLO la fila de estado (2 filas sobre la caja; vale en vivo y en modo lectura).
  function updateStatus() {
    if (!uiVisible) return;
    out('\x1b7' + '\x1b[2A\r\x1b[2K' + clip(statusLine()) + '\x1b8');
  }

  // Reescribe SOLO la caja (el cursor vive en su fila): borrar, pintar, reposicionar columna.
  function updateInput() {
    if (!uiVisible) return;
    const inp = inputLine();
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
  function drawUIAt() {
    const w = Math.max(2, cols() - 2);
    const inp = inputLine();
    out(AT(rows() - 3, 1) + CLR + clip(statusLine()));
    out(AT(rows() - 2, 1) + CLR + c.gray('╭' + '─'.repeat(w) + '╮'));
    out(AT(rows() - 1, 1) + CLR + clip(inp.text));
    out(AT(rows(), 1) + CLR + c.gray('╰' + '─'.repeat(w) + '╯'));
    out(AT(rows() - 1, 1 + Math.max(0, inp.col)));
    uiVisible = true;
  }

  function renderScroll() {
    paintRows(lines, scrollOff);
    drawUIAt();
  }

  // Sale del modo lectura SIN romper el scrollback nativo: restaura la pantalla como estaba al entrar
  // (la cola en vivo de ese momento) y lo llegado DURANTE la lectura se imprime por el flujo normal.
  function exitScroll() {
    scrollOff = 0;
    const entry = entryCount == null ? lines.length : entryCount;
    entryCount = null;
    const pending = lines.slice(entry);
    pendingNew = 0;
    paintRows(lines.slice(0, entry), 0);
    drawUIAt();
    if (pending.length) {
      eraseUI();
      out(pending.join('\n') + '\n');
      drawUI();
    }
  }

  // Mueve la vista de lectura (rueda/PgUp/PgDn/Ctrl+Home). Entra al modo solo cuando HAY historial que
  // no cabe en pantalla; volver a 0 sale y muestra lo pendiente. La caja queda fija y usable siempre.
  function setScroll(n) {
    const max = Math.max(0, flatRows(lines).length - viewportH());
    const v = Math.max(0, Math.min(n, max));
    if (v > 0 && scrollOff === 0) {
      if (!max) return;                 // todo cabe en pantalla: no hay nada que desplazar
      entryCount = lines.length;
    }
    if (v === scrollOff) return;
    scrollOff = v;
    if (v === 0) exitScroll();
    else renderScroll();
  }

  // Imprime al historial. En vivo: al buffer normal de la terminal (scrollback real). En modo lectura:
  // se acumula SIN mover la vista (el usuario está leyendo) y el aviso "↓ N mensajes nuevos" lo anuncia.
  function print(text = '') {
    const added = String(text).split('\n');
    lines.push(...added);
    trim();
    if (scrollOff > 0) {
      const w = cols();
      let addedRows = 0;
      for (const l of added) addedRows += wrapAnsi(l, w).length;
      scrollOff += addedRows;           // la ventana visible no se mueve
      pendingNew++;
      updateStatus();
      return;
    }
    eraseUI();
    out(String(text) + '\n');
    drawUI();
  }

  function tick() { frame = (frame + 1) % FRAMES.length; updateStatus(); }

  function redraw() {
    if (scrollOff > 0) return renderScroll();
    eraseUI();
    drawUI();
  }

  // Fija el contenido de la caja (historial de envíos) dejando el cursor al final.
  function setBuf(v) {
    buf = String(v);
    cur = buf.length;
    updateStatus();
    updateInput();
  }

  // Resuelve el chooser activo y devuelve la caja a modo texto.
  function settleChooser(result) {
    const ch = chooser;
    chooser = null;
    updateInput();
    ch.resolve(result);
  }

  // Editor de línea PERSISTENTE: nunca se desconecta, así se puede escribir aunque el agente esté trabajando.
  function handleData(chunk) {
    const str = String(chunk);
    // MODO LECTURA: rueda del mouse y teclas de página funcionan SIEMPRE (también con chooser activo o
    // mientras el agente piensa) — releer la conversación no interrumpe nada y la caja sigue fija.
    const wd = wheelDelta(str);
    if (wd !== null) { if (wd) setScroll(scrollOff + wd); return; }             // rueda; clicks se ignoran
    if (str === '\x1b[5~') return setScroll(scrollOff + viewportH() - 1);       // PgUp
    if (str === '\x1b[6~') return setScroll(scrollOff - (viewportH() - 1));     // PgDn
    if (str === '\x1b[1;5H') return setScroll(Number.MAX_SAFE_INTEGER);         // Ctrl+Home → INICIO
    if (str === '\x1b[1;5F') return setScroll(0);                               // Ctrl+End → en vivo
    // Chooser activo: las teclas van al selector, no al editor de línea.
    if (chooser) {
      if (str === '\x03') { if (onExit) onExit(); return; }                                 // Ctrl+C, siempre
      if (str === '\x1b') return settleChooser(null);                                       // ESC = cancelar
      if (str === '\x1b[C' || str === '\x1b[B') { chooser.idx = (chooser.idx + 1) % chooser.options.length; return updateInput(); }
      if (str === '\x1b[D' || str === '\x1b[A') { chooser.idx = (chooser.idx - 1 + chooser.options.length) % chooser.options.length; return updateInput(); }
      if (str === '\r' || str === '\n') return settleChooser(chooser.idx);
      const low = str.toLowerCase();
      if (low === 'y' || low === 's') return settleChooser(0);                              // atajos de teclado
      if (low === 'n') return settleChooser(chooser.options.length - 1);
      return;   // el resto se ignora mientras se elige
    }
    // ESC "solo" (el chunk es únicamente \x1b): con TEXTO en la caja, la limpia (descarta lo escrito);
    // con la caja vacía, interrumpe el turno en curso. Una secuencia (flechas: '\x1b[A') llega con más
    // bytes en el mismo chunk y no cuenta como ESC.
    if (str === '\x1b') {
      if (buf) {
        buf = '';
        cur = 0;
        histIdx = -1;
        updateStatus();
        updateInput();
        return;
      }
      if (onEsc) onEsc();
      return;
    }
    // Edición de la caja: mover el cursor, saltar, borrar bajo el cursor y navegar el historial de envíos.
    if (str === '\x1b[D') { cur = Math.max(0, cur - 1); return updateInput(); }                    // ←
    if (str === '\x1b[C') { cur = Math.min(buf.length, cur + 1); return updateInput(); }           // →
    if (str === '\x1b[H' || str === '\x1b[1~') { cur = 0; return updateInput(); }                  // Home
    if (str === '\x1b[F' || str === '\x1b[4~') {                                                   // End
      if (scrollOff > 0) return setScroll(0);   // leyendo historial: End vuelve al final en vivo
      cur = buf.length;
      return updateInput();
    }
    if (str === '\x1b[3~') {                                                                       // Supr
      buf = buf.slice(0, cur) + buf.slice(cur + 1);
      updateStatus();
      return updateInput();
    }
    if (str === '\x1b[A') {                                                                        // ↑ historial
      if (!hist.length) return;
      histIdx = histIdx < 0 ? hist.length - 1 : Math.max(0, histIdx - 1);
      return setBuf(hist[histIdx]);
    }
    if (str === '\x1b[B') {                                                                        // ↓ historial
      if (histIdx < 0) return;
      histIdx++;
      if (histIdx >= hist.length) { histIdx = -1; return setBuf(''); }
      return setBuf(hist[histIdx]);
    }
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '\x03') { if (onExit) onExit(); return; }                                  // Ctrl+C, siempre
      if (ch === '\r' || ch === '\n') {
        const v = buf;
        buf = ''; cur = 0; histIdx = -1;
        if (v.trim()) { hist.push(v); if (hist.length > 100) hist.shift(); if (onLine) onLine(v); }   // el eco lo decide la shell
        continue;
      }
      if (ch === '\x7f' || ch === '\b') {              // Backspace: borra ANTES del cursor
        if (cur > 0) { buf = buf.slice(0, cur - 1) + buf.slice(cur); cur--; }
        continue;
      }
      if (ch === '\t') {                               // Tab: completa al primer comando sugerido
        const m = matchSlash(commands, buf);
        if (m.length) { buf = m[0].cmd + ' '; cur = buf.length; }
        continue;
      }
      if (ch === '\x1b') break;                        // secuencia de escape (flechas…): se ignora el resto
      if (ch >= ' ') { buf = buf.slice(0, cur) + ch + buf.slice(cur); cur++; }   // inserta EN el cursor
    }
    updateStatus();   // las sugerencias "/…" viven aquí y siguen cada tecla
    updateInput();
  }

  return {
    open() {
      // Mouse en modo SGR: la rueda controla el modo lectura con la caja fija (sin esto, la rueda
      // movería el viewport nativo y la caja se iría de pantalla). Seleccionar texto: Shift+arrastre.
      out('\x1b[?1000h\x1b[?1006h');
      // El banner se imprime al buffer normal (y a `lines`): queda arriba en el historial, como una línea más.
      for (const line of header) { lines.push(line); out(line + '\n'); }
      const sep = c.gray('─'.repeat(Math.max(2, cols() - 1)));
      lines.push(sep);
      out(sep + '\n');
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', handleData);
      process.stdout.on('resize', redraw);
      drawUI();
    },

    print,

    // La shell registra aquí su enrutador de líneas (aprobación / tarea / cola).
    setOnLine(fn) { onLine = fn; },

    // Selector en la caja de entrada: imprime la pregunta al historial y convierte la caja en un chooser
    // ←/→ + Enter (con atajos y/s/n). Resuelve el índice elegido, o null si se cancela con ESC.
    choose(question, options) {
      if (question) print(question);
      return new Promise((resolve) => {
        chooser = { options: options.map(String), idx: 0, resolve };
        updateInput();
      });
    },

    startThinking(label = 'pensando…') {
      thinking = true; thinkLabel = label; thinkStartedAt = Date.now();
      if (!timer) { timer = setInterval(tick, 250); timer.unref?.(); }
      updateStatus();
    },
    stopThinking() {
      thinking = false;
      if (timer) { clearInterval(timer); timer = null; }
      updateStatus();
    },

    close() {
      if (timer) { clearInterval(timer); timer = null; }
      process.stdin.off('data', handleData);
      process.stdout.off('resize', redraw);
      out('\x1b[?1000l\x1b[?1006l');   // mouse apagado ANTES de salir: no dejar la terminal capturando
      if (scrollOff > 0) exitScroll(); // salir leyendo no pierde lo pendiente: se imprime al flujo
      // Se borra SOLO la franja viva: la transcripción ya vive en el buffer normal de la terminal,
      // así que la conversación completa queda en el scroll nativo después de salir.
      eraseUI();
      out('\x1b[?25h');
      try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch { /* ya restaurado */ }
      process.stdin.pause();
    }
  };
}
