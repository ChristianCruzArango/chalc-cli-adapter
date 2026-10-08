// Prompts interactivos del CLI: preguntas de texto, selectores con flechas/buscador,
// entrada enmascarada, spinner y lectura de texto pegado.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { t } from '../i18n.mjs';
import { c, cleanPath } from './context.mjs';
import { CommandExit } from './exit.mjs';

// ---------- prompts interactivos ----------
const YES = new Set(['y', 's', 'si', 'sí', 'yes']);

// Una pregunta de texto = un readline efímero (deja stdin libre para el selector de flechas).
function ask(query) {
  return new Promise((res, rej) => {
    const rl = createInterface({ input: stdin, output: stdout });
    rl.question(query)
      .then((a) => { rl.close(); res(a); })
      .catch(() => {           // Ctrl+C en una pregunta: cancelar limpio, sin stack trace
        rl.close();
        stdout.write('\n' + c.dim(t('cancelled')) + '\n');
        rej(new CommandExit(130));
      });
  });
}

// Escucha teclas en modo raw hasta que `onKey(ch, key, done)` llame a `done(result)`. Ctrl+C rechaza
// con CommandExit(130): lanzar dentro de un manejador de teclas no llegaría al entrypoint, y
// `process.exit` se saltaba el guardado del log de tokens. Común a los selectores y a la entrada secreta.
function listenKeys(onKey, { beforeEnd = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    emitKeypressEvents(stdin);
    const wasRaw = !!stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    const done = (result, cancelled = false) => {
      stdin.removeListener('keypress', handler);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      beforeEnd(cancelled);
      if (cancelled) reject(new CommandExit(130));
      else resolve(result);
    };
    const handler = (ch, key) => onKey(ch, key, done);
    stdin.on('keypress', handler);
  });
}

// Selector con flechas ↑/↓ + Enter (modo raw).
function arrowSelect(q, options, def = 0) {
  let idx = Math.max(0, Math.min(def, options.length - 1));
  stdout.write(`${c.cyan('?')} ${q}  ${c.dim(t('arrowHint'))}\n`);
  const draw = () => {
    options.forEach((o, i) => {
      const line = i === idx ? c.cyan(`❯ ${o.label}`) : `  ${c.dim(o.label)}`;
      stdout.write('\x1b[2K' + line + '\n');
    });
  };
  draw();
  return listenKeys((_s, key, done) => {
    if (!key) return;
    if (key.name === 'up' || key.name === 'k') idx = (idx - 1 + options.length) % options.length;
    else if (key.name === 'down' || key.name === 'j') idx = (idx + 1) % options.length;
    else if (key.name === 'return' || key.name === 'enter') return done(idx);
    else if (key.ctrl && key.name === 'c') { stdout.write('\n'); return done(null, true); }   // 130: cancelado, no éxito
    else return;
    stdout.write(`\x1b[${options.length}A`);   // sube N líneas y redibuja las opciones
    draw();
  });
}

// Fallback a números cuando no hay TTY.
async function numberedSelect(q, options, def = 0) {
  console.log(`${c.cyan('?')} ${q}`);
  options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}${i === def ? c.dim('  ‹enter›') : ''}`));
  while (true) {
    const ans = (await ask(`  ${c.dim('>')} `)).trim();
    if (!ans) return def;
    const n = parseInt(ans, 10);
    if (n >= 1 && n <= options.length) return n - 1;
    console.log(c.dim('    ' + t('optionInvalid')));
  }
}

// Pinta el buscador sobre lo que pintó la vez anterior. Devuelve cuántas líneas ocupa ahora.
function drawSearch(q, query, view, idx, prevLines) {
  if (prevLines) stdout.write(`\x1b[${prevLines}A`);
  stdout.write('\x1b[J');
  stdout.write(`${c.cyan('?')} ${q}  ${c.dim(t('searchHint'))}\n`);
  stdout.write(`  ${c.dim(t('searchLabel'))} ${query}${c.dim('▏')}\n`);
  if (!view.length) stdout.write('  ' + c.dim(t('searchNoMatches')) + '\n');
  else view.forEach(({ o }, i) => stdout.write((i === idx ? c.cyan(`❯ ${o.label}`) : `  ${c.dim(o.label)}`) + '\n'));
  return 2 + (view.length || 1);
}

// Selector con buscador: escribe para filtrar por substring, ↑/↓ se mueve por lo filtrado, Enter elige.
// Devuelve el índice ORIGINAL (en `options`), no el de la vista filtrada.
function searchSelect(q, options) {
  let query = '';
  let idx = 0;
  const match = () => options.map((o, i) => ({ o, i })).filter(({ o }) => o.label.toLowerCase().includes(query.toLowerCase()));
  let view = match();
  let lines = drawSearch(q, query, view, idx, 0);
  return listenKeys((ch, key, done) => {
    if (!key) return;
    if (key.name === 'up') idx = view.length ? (idx - 1 + view.length) % view.length : 0;
    else if (key.name === 'down') idx = view.length ? (idx + 1) % view.length : 0;
    else if (key.name === 'return' || key.name === 'enter') { if (view.length) return done(view[idx].i); return; }
    else if (key.ctrl && key.name === 'c') { stdout.write('\n'); return done(null, true); }   // 130: cancelado, no éxito
    else if (key.name === 'backspace') { query = query.slice(0, -1); view = match(); idx = 0; }
    else if (ch && !key.ctrl && ch >= ' ') { query += ch; view = match(); idx = 0; }
    else return;
    lines = drawSearch(q, query, view, idx, lines);
  });
}

// Entrada enmascarada (para API keys): muestra '*' y nunca eco del texto real. Ctrl+C cancela con
// 130, como el resto de la CLI (antes salía con 0, como si hubiera ido bien).
async function secret(q) {
  if (!stdin.isTTY) return (await ask(`${c.cyan('?')} ${q} `)).trim();
  stdout.write(`${c.cyan('?')} ${q} `);
  let buf = '';
  const typed = await listenKeys((ch, key, done) => {
    if (key && (key.name === 'return' || key.name === 'enter')) return done(buf);
    if (key && key.ctrl && key.name === 'c') return done(null, true);
    if (key && (key.name === 'backspace' || key.name === 'delete')) {
      if (buf) { buf = buf.slice(0, -1); stdout.write('\b \b'); }
      return;
    }
    if (ch && !(key && key.ctrl) && ch >= ' ') { buf += ch; stdout.write('*'); }
  }, { beforeEnd: () => stdout.write('\n') });
  return typed.trim();
}

async function multi(q, options, def = []) {
  console.log(`${c.cyan('?')} ${q} ${c.dim(t('multiHint'))}`);
  options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}`));
  const ans = (await ask(`  ${c.dim('>')} `)).trim().toLowerCase();
  if (!ans) return def;
  if (ans === 'a') return options.map((_, i) => i);
  return [...new Set(ans.split(/[,\s]+/).map((n) => parseInt(n, 10) - 1).filter((n) => n >= 0 && n < options.length))];
}

export function makePrompter() {
  return {
    async text(q) { return (await ask(`${c.cyan('?')} ${q} `)).trim(); },
    async yesno(q, def = false) {
      const ans = (await ask(`${c.cyan('?')} ${q} ${def ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
      if (!ans) return def;
      return YES.has(ans);
    },
    async select(q, options, def = 0, opts = {}) {
      if (!stdin.isTTY) return numberedSelect(q, options, def);
      return opts.search ? searchSelect(q, options) : arrowSelect(q, options, def);
    },
    multi,
    secret,
    // Cada pregunta abre y cierra su propio readline, así que no queda nada abierto que cerrar. Se
    // mantiene para que los comandos marquen el fin del diálogo sin depender de cómo pregunta.
    close() { }
  };
}

export function readPasted() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout });
    const lines = [];
    rl.on('line', (l) => { if (l.trim() === 'END') rl.close(); else lines.push(l); });
    rl.on('close', () => resolve(lines.join('\n')));
  });
}

// Spinner para operaciones largas (llamada a la IA): muestra que SÍ está trabajando.
export function startSpinner(msg) {
  if (!stdout.isTTY) { console.log(c.dim('  ' + msg)); return null; }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const id = setInterval(() => stdout.write(`\r  ${c.cyan(frames[i++ % frames.length])} ${c.dim(msg)}`), 80);
  return id;
}
export function stopSpinner(id) {
  if (id) { clearInterval(id); stdout.write('\r\x1b[2K'); }
}

// Pregunta una ruta OBLIGATORIA: re-pregunta si la dejas vacía o si no existe. No deja pasar nada. (Ctrl+C cancela.)
export async function askExistingPath(prompter, question) {
  while (true) {
    const ans = (await prompter.text(question + ':')).trim();
    if (!ans) { console.log(c.yellow('  ! ' + t('pathRequired'))); continue; }
    const p = resolve(cleanPath(ans));
    if (!existsSync(p)) { console.log(c.yellow('  ! ' + t('pathMissing', p))); continue; }
    return p;
  }
}
