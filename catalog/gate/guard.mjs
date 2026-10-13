// guard.mjs — la guarda del asistente (spec 017, R1–R5). Responsabilidad ÚNICA: convertir el evento de
// un hook `PreToolUse` en la respuesta que el asistente entiende. Razón de cambio: el formato de esa
// respuesta. Qué se pregunta o se bloquea lo decide `lib/guard-rules.mjs`; aquí no hay criterio.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/`. Se invoca desde un hook de Claude Code:
//
//   node .chalc/gate/guard.mjs
//
// Tres reglas de oficio, porque corre DENTRO del turno del asistente:
//   - Cuando la acción pasa, NO responde nada. Responder `allow` la aprobaría saltándose los permisos
//     que el usuario tiene configurados; callar deja que el asistente siga su flujo normal.
//   - Sale SIEMPRE con 0 y nunca espera una entrada que no llega: un hook que rompe o cuelga el turno es
//     peor que no tener hook.
//   - Sube el listón, no es inviolable: un comando ofuscado a propósito puede esquivarla.

import { decide } from './lib/guard-rules.mjs';
import { loadConfig } from './lib/config.mjs';
import { messageOf } from './lib/i18n.mjs';
import { readStdin } from './lib/stdin.mjs';

/** La respuesta `PreToolUse` de Claude Code para un veredicto, o null si la acción pasa sin más. */
export function hookOutput({ decision, rule, data }, lang) {
  if (decision === 'allow') return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: messageOf(rule, data, lang)
    }
  };
}

/** La respuesta para el texto de un evento, o null si no hay nada que decir (también si es ilegible). */
export async function guardEvent(stdin, { root }) {
  let event;
  try { event = JSON.parse(stdin); } catch { return null; }
  const verdict = decide(event, { root });
  // `hookOutput` ya calla ante `allow`; volver aquí antes evita leer `gate.json` en CADA acción del
  // asistente, que es cuando corre la guarda.
  if (verdict.decision === 'allow') return null;
  // El idioma es el del proyecto (`gate.json`) o, sin él, el del entorno: el del resto del portón.
  const { config } = await loadConfig(root);
  return hookOutput(verdict, config.language);
}

// Entrada de línea de comandos. La raíz la da Claude Code en `CLAUDE_PROJECT_DIR`; el `cwd` del evento
// es dónde está la shell ahora, que puede ser una subcarpeta.
if (process.argv[1] && /guard\.mjs$/.test(process.argv[1])) {
  try {
    const answer = await guardEvent(await readStdin(), { root: process.env.CLAUDE_PROJECT_DIR || process.cwd() });
    if (answer) process.stdout.write(JSON.stringify(answer));
  } catch { /* la guarda nunca puede romper el turno de quien está trabajando */ }
  process.exit(0);
}
