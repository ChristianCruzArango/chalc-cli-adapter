// cli/engine/verify.mjs — portón de VERIFICACIÓN determinista del orquestador. El coder puede "creer"
// que terminó y el reviewer solo LEE (no compila): aquí se corre la toolchain REAL del proyecto y, si
// falla, su salida son hallazgos objetivos que alimentan una ronda de corrección del coder.
// Es código, no modelo: no opina, no alucina y no aprueba de cortesía.

import { execBounded } from '../tools/shell.mjs';

// Comando de verificación por stack (gana el primero presente). Solo stacks con chequeo estático
// confiable y acotado; sin entrada → no hay portón (skipped: el orquestador sigue sin bloquear).
const VERIFY_COMMANDS = [
  { stack: 'angular', command: 'npx ng build --configuration development' },
  { stack: 'flutter', command: 'flutter analyze' },
  { stack: 'dotnet', command: 'dotnet build --nologo' }
];

export function verifyCommand(stacks = []) {
  return VERIFY_COMMANDS.find((v) => stacks.includes(v.stack))?.command || null;
}

const MAX_OUTPUT = 4000;   // los errores caben; el prompt del fix no se desborda
const DEFAULT_TIMEOUT_MS = 300000;   // un build de front en CPU modesta toma minutos legítimamente

// Corre el chequeo del stack en la raíz del proyecto.
// → { skipped:true, ok:true } sin comando · { ok, command, output, timedOut? } si corrió.
// En fallo el output se recorta por el FINAL: ahí concentran los errores casi todas las toolchains.
export async function runVerify({ projectPath, stacks, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const command = verifyCommand(stacks);
  if (!command) return { skipped: true, ok: true };
  const r = await execBounded(command, { cwd: projectPath, timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  const raw = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  const ok = r.code === 0 && !r.timedOut;
  return {
    ok,
    command,
    output: ok ? '' : (raw.length > MAX_OUTPUT ? '…' + raw.slice(-MAX_OUTPUT) : raw),
    ...(r.timedOut ? { timedOut: true } : {})
  };
}
