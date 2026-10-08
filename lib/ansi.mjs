// lib/ansi.mjs — la ÚNICA paleta de colores de la terminal (antes había tres: la shell, los comandos y
// el dashboard). Respeta NO_COLOR y la salida no-TTY (una tubería, CI): ahí todo sale en texto plano.

const COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR;
const sgr = (code) => (s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  bold: sgr(1), dim: sgr(2), red: sgr(31), green: sgr(32),
  yellow: sgr(33), blue: sgr(34), cyan: sgr(36), gray: sgr(90)
};

export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}
