// cli/ui/select.mjs — selector inline con flechas para el modo scroll (sin dependencias).
// Dibuja las opciones en UNA línea: ←/→ (o ↑/↓) mueve, Enter elige, ESC cancela (null),
// y con atajos de teclado: y/s = primera opción, n = última. Sin TTY devuelve null (el
// llamador cae a una pregunta de texto). El input se restaura exactamente como estaba.

import { emitKeypressEvents } from 'node:readline';

export function selectInline(question, options, { input = process.stdin, output = process.stdout } = {}) {
  const opts = options.map(String);
  if (!input.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    emitKeypressEvents(input);
    const wasRaw = !!input.isRaw;
    input.setRawMode(true);
    input.resume();
    let idx = 0;
    const render = () => {
      const line = opts.map((o, i) => (i === idx ? `\x1b[36m❯ ${o}\x1b[0m` : `\x1b[2m  ${o}\x1b[0m`)).join('   ');
      output.write(`\r\x1b[2K${question}  ${line} \x1b[2m ←/→ · enter · esc\x1b[0m`);
    };
    const done = (result) => {
      input.removeListener('keypress', onKey);
      try { input.setRawMode(wasRaw); } catch { /* stream cerrado */ }
      input.pause();
      output.write('\n');
      resolve(result);
    };
    const onKey = (ch, key) => {
      if (!key) return;
      if (key.name === 'left' || key.name === 'up') { idx = (idx - 1 + opts.length) % opts.length; return render(); }
      if (key.name === 'right' || key.name === 'down') { idx = (idx + 1) % opts.length; return render(); }
      if (key.name === 'return' || key.name === 'enter') return done(idx);
      if (key.name === 'escape') return done(null);
      if (key.ctrl && key.name === 'c') return done(null);
      const low = String(ch || '').toLowerCase();
      if (low === 'y' || low === 's') return done(0);
      if (low === 'n') return done(opts.length - 1);
    };
    input.on('keypress', onKey);
    render();
  });
}
