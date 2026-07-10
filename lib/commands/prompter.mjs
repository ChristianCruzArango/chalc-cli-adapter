// Prompts interactivos del CLI: preguntas de texto, selectores con flechas/buscador,
// entrada enmascarada, spinner y lectura de texto pegado.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { t } from '../i18n.mjs';
import { c, cleanPath } from './context.mjs';

// ---------- prompts interactivos ----------
export function makePrompter() {
  const yes = new Set(['y', 's', 'si', 'sí', 'yes']);

  // Una pregunta de texto = un readline efímero (deja stdin libre para el selector de flechas).
  function ask(query) {
    return new Promise((res) => {
      const rl = createInterface({ input: stdin, output: stdout });
      rl.question(query)
        .then((a) => { rl.close(); res(a); })
        .catch(() => {           // Ctrl+C en una pregunta: cancelar limpio, sin stack trace
          rl.close();
          stdout.write('\n' + c.dim(t('cancelled')) + '\n');
          process.exit(130);
        });
    });
  }

  // Selector con flechas ↑/↓ + Enter (modo raw). Fallback a números si no hay TTY.
  function arrowSelect(q, options, def = 0) {
    return new Promise((resolve) => {
      let idx = Math.max(0, Math.min(def, options.length - 1));
      stdout.write(`${c.cyan('?')} ${q}  ${c.dim(t('arrowHint'))}\n`);
      const draw = () => {
        options.forEach((o, i) => {
          const line = i === idx ? c.cyan(`❯ ${o.label}`) : `  ${c.dim(o.label)}`;
          stdout.write('\x1b[2K' + line + '\n');
        });
      };
      draw();
      emitKeypressEvents(stdin);
      const wasRaw = !!stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);
      stdin.resume();
      const done = () => {
        stdin.removeListener('keypress', onKey);
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdin.pause();
        resolve(idx);
      };
      const onKey = (_s, key) => {
        if (!key) return;
        if (key.name === 'up' || key.name === 'k') idx = (idx - 1 + options.length) % options.length;
        else if (key.name === 'down' || key.name === 'j') idx = (idx + 1) % options.length;
        else if (key.name === 'return' || key.name === 'enter') return done();
        else if (key.ctrl && key.name === 'c') { done(); stdout.write('\n'); process.exit(130); }   // 130: cancelado, no éxito
        else return;
        stdout.write(`\x1b[${options.length}A`);   // sube N líneas y redibuja las opciones
        draw();
      };
      stdin.on('keypress', onKey);
    });
  }

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

  // Selector con buscador: escribe para filtrar por substring, ↑/↓ se mueve por lo filtrado, Enter elige.
  // Devuelve el índice ORIGINAL (en `options`), no el de la vista filtrada.
  function searchSelect(q, options) {
    return new Promise((resolve) => {
      let query = '';
      let idx = 0;
      const match = () => options.map((o, i) => ({ o, i })).filter(({ o }) => o.label.toLowerCase().includes(query.toLowerCase()));
      let view = match();
      let prevLines = 0;
      const render = () => {
        if (prevLines) stdout.write(`\x1b[${prevLines}A`);
        stdout.write('\x1b[J');
        stdout.write(`${c.cyan('?')} ${q}  ${c.dim('escribe para filtrar · ↑/↓ · enter')}\n`);
        stdout.write(`  ${c.dim('buscar:')} ${query}${c.dim('▏')}\n`);
        if (!view.length) stdout.write('  ' + c.dim('(sin coincidencias)') + '\n');
        else view.forEach(({ o }, i) => stdout.write((i === idx ? c.cyan(`❯ ${o.label}`) : `  ${c.dim(o.label)}`) + '\n'));
        prevLines = 2 + (view.length || 1);
      };
      render();
      emitKeypressEvents(stdin);
      const wasRaw = !!stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);
      stdin.resume();
      const done = (result) => {
        stdin.removeListener('keypress', onKey);
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdin.pause();
        resolve(result);
      };
      const onKey = (ch, key) => {
        if (!key) return;
        if (key.name === 'up') idx = view.length ? (idx - 1 + view.length) % view.length : 0;
        else if (key.name === 'down') idx = view.length ? (idx + 1) % view.length : 0;
        else if (key.name === 'return' || key.name === 'enter') { if (view.length) return done(view[idx].i); return; }
        else if (key.ctrl && key.name === 'c') { done(view.length ? view[idx].i : 0); stdout.write('\n'); process.exit(130); }   // 130: cancelado, no éxito
        else if (key.name === 'backspace') { query = query.slice(0, -1); view = match(); idx = 0; }
        else if (ch && !key.ctrl && ch >= ' ') { query += ch; view = match(); idx = 0; }
        else return;
        render();
      };
      stdin.on('keypress', onKey);
    });
  }

  return {
    async text(q) { return (await ask(`${c.cyan('?')} ${q} `)).trim(); },
    async yesno(q, def = false) {
      const ans = (await ask(`${c.cyan('?')} ${q} ${def ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
      if (!ans) return def;
      return yes.has(ans);
    },
    async select(q, options, def = 0, opts = {}) {
      if (!stdin.isTTY) return numberedSelect(q, options, def);
      return opts.search ? searchSelect(q, options) : arrowSelect(q, options, def);
    },
    async multi(q, options, def = []) {
      console.log(`${c.cyan('?')} ${q} ${c.dim(t('multiHint'))}`);
      options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}`));
      const ans = (await ask(`  ${c.dim('>')} `)).trim().toLowerCase();
      if (!ans) return def;
      if (ans === 'a') return options.map((_, i) => i);
      return [...new Set(ans.split(/[,\s]+/).map((n) => parseInt(n, 10) - 1).filter((n) => n >= 0 && n < options.length))];
    },
    // Entrada enmascarada (para API keys): muestra '*' y nunca eco del texto real.
    async secret(q) {
      if (!stdin.isTTY) return (await ask(`${c.cyan('?')} ${q} `)).trim();
      return new Promise((resolve) => {
        stdout.write(`${c.cyan('?')} ${q} `);
        emitKeypressEvents(stdin);
        const wasRaw = !!stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        let buf = '';
        const finish = () => {
          stdin.removeListener('keypress', onKey);
          stdin.setRawMode(wasRaw);
          stdin.pause();
          stdout.write('\n');
          resolve(buf.trim());
        };
        const onKey = (ch, key) => {
          if (key && (key.name === 'return' || key.name === 'enter')) return finish();
          if (key && key.ctrl && key.name === 'c') { finish(); process.exit(0); }
          if (key && (key.name === 'backspace' || key.name === 'delete')) {
            if (buf) { buf = buf.slice(0, -1); stdout.write('\b \b'); }
            return;
          }
          if (ch && !(key && key.ctrl) && ch >= ' ') { buf += ch; stdout.write('*'); }
        };
        stdin.on('keypress', onKey);
      });
    },
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
