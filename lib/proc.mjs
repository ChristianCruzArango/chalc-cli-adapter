// lib/proc.mjs — ejecutar binarios del ecosistema Node de forma portable.
// En Windows, npx/npm/ng/nest/flutter/yarn/pnpm son shims .cmd/.bat: child_process NO los resuelve por PATHEXT
// salvo con shell:true, así que `spawn('npx', …)` lanza ENOENT (en macOS/Linux son binarios reales y funcionan).
// dotnet/git/node son .exe y no lo necesitan, pero shell:true es inocuo para ellos.
// Centralizado para que el ajuste por SO viva en un solo lugar.

export const IS_WINDOWS = process.platform === 'win32';

// Mezcla opciones de spawn/execFile añadiendo shell:true solo en Windows.
// Seguro mientras los args no contengan espacios ni metacaracteres de shell (en chalc los args son
// controlados: flags fijos y nombres de proyecto saneados a kebab-case).
export function procOpts(opts = {}) {
  return IS_WINDOWS ? { ...opts, shell: true } : opts;
}
