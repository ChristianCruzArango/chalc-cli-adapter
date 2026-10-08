// cli/engine/verify.mjs — portón de VERIFICACIÓN determinista del orquestador. El coder puede "creer"
// que terminó y el reviewer solo LEE (no compila): aquí se corre la toolchain REAL del proyecto y, si
// falla, su salida son hallazgos objetivos que alimentan una ronda de corrección del coder.
// Es código, no modelo: no opina, no alucina y no aprueba de cortesía.

import { join } from 'node:path';
import { execBounded, commandTokens } from '../tools/shell.mjs';
import { CONFIG_REL } from '../../catalog/gate/lib/config.mjs';
import { MAX_CHILD_OUTPUT } from '../../lib/proc.mjs';
import { readJsonOrKeepSync } from '../../lib/userdata.mjs';

// Comando de verificación por stack (gana el primero presente). Solo stacks con chequeo estático
// confiable y acotado; sin entrada → no hay portón (skipped: el orquestador sigue sin bloquear).
// `npx --no-install`: usa el `ng` del proyecto y nunca descarga nada. Sin él, en un repo sin
// `@angular/cli` local, `npx ng` podía resolver el paquete `ng` de npm, que no es el CLI de Angular.
const VERIFY_COMMANDS = [
  { stack: 'angular', command: 'npx --no-install ng build --configuration development' },
  { stack: 'flutter', command: 'flutter analyze' },
  { stack: 'dotnet', command: 'dotnet build --nologo' }
];

// El comando de verificación: el que el proyecto declare en `.chalc/gate.json` (`verify.command`) o,
// si no declara ninguno, el del stack. Antes solo había Angular, Flutter y .NET; un proyecto JS o
// Python no tenía forma de pedir el suyo. Lo declarado pasa igualmente por el perfil de confianza y
// por la confirmación explícita (S-18), porque viene del repositorio.
export function verifyCommand(stacks = [], { projectPath } = {}) {
  if (projectPath) {
    // Sin gate.json se usa el del stack; uno ilegible se respalda y se avisa (lib/userdata.mjs).
    const declared = readJsonOrKeepSync(join(projectPath, CONFIG_REL), {})?.verify?.command;
    if (typeof declared === 'string' && declared.trim()) return declared.trim();
  }
  return VERIFY_COMMANDS.find((v) => stacks.includes(v.stack))?.command || null;
}

// ¿Lo permite el perfil de confianza? El mismo criterio que la shell: el binario tiene que estar en la
// lista. Con el perfil `safe` (lista vacía) un build —que ejecuta código del repo: builders de Angular,
// targets de MSBuild— no corre.
export function verifyAllowed(command, allow = []) {
  const [base] = commandTokens(command || '');
  return !!base && allow.includes(base);
}

const MAX_OUTPUT = 4000;   // los errores caben; el prompt del fix no se desborda
const DEFAULT_TIMEOUT_MS = 300000;   // un build de front en CPU modesta toma minutos legítimamente

// Corre el chequeo del stack en la raíz del proyecto.
// → { skipped:true, ok:null } sin comando —NO es un «ok»: no se verificó nada— · { ok, command, output, timedOut? } si corrió.
// En fallo el output se recorta por el FINAL: ahí concentran los errores casi todas las toolchains.
export async function runVerify({ projectPath, stacks, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const command = verifyCommand(stacks, { projectPath });
  if (!command) return { skipped: true, ok: null };
  const r = await execBounded(command, { cwd: projectPath, timeoutMs, maxBuffer: MAX_CHILD_OUTPUT });
  const raw = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  const ok = r.code === 0 && !r.timedOut;
  return {
    ok,
    command,
    output: ok ? '' : (raw.length > MAX_OUTPUT ? '…' + raw.slice(-MAX_OUTPUT) : raw),
    ...(r.timedOut ? { timedOut: true } : {})
  };
}
