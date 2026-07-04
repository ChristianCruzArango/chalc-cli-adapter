// cli/ui/spinner.mjs — indicador de "trabajando…" para que la sesión se sienta viva mientras el modelo local
// (que puede tardar segundos) genera. Sin dependencias: braille + ANSI. No-op si no es TTY o hay NO_COLOR,
// así la salida por pipe queda limpia. Se detiene antes de imprimir cualquier línea y antes de pedir input.

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function createSpinner(stream = process.stdout) {
  const active = !!stream.isTTY && !process.env.NO_COLOR;
  let timer = null;
  let i = 0;
  let text = '';
  let startedAt = 0;
  // Cronómetro visible: con modelos locales lentos, ver los segundos correr distingue "pensando" de "colgado".
  const elapsed = () => { const s = Math.floor((Date.now() - startedAt) / 1000); return s >= 3 ? ` \x1b[2m${s}s\x1b[0m` : ''; };
  const draw = () => stream.write(`\r\x1b[2K\x1b[36m${FRAMES[(i = (i + 1) % FRAMES.length)]}\x1b[0m ${text}${elapsed()}`);

  return {
    start(label = '') {
      if (!active || timer) return;
      text = label;
      startedAt = Date.now();
      timer = setInterval(draw, 250);
      timer.unref?.();
      draw();
    },
    update(label) { text = label; },
    stop() {
      if (!active) return;
      if (timer) { clearInterval(timer); timer = null; }
      stream.write('\r\x1b[2K');   // borra la línea del spinner
    }
  };
}
