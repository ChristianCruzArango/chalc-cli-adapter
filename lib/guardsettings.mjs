// lib/guardsettings.mjs — la guarda dentro de `.claude/settings.local.json` (spec 023, R1–R3, R15, R16).
// Responsabilidad ÚNICA: dado el objeto del archivo, devolver el objeto con (o sin) lo que chalc añade para
// activar la guarda. Razón de cambio: qué entradas activan la guarda en Claude Code. Puro: no lee ni escribe
// disco (eso es `guardemit.mjs`) y no tiene idioma.
//
// Dos capas, las dos fuera del modelo:
//   - permisos `ask` nativos: Claude Code pregunta antes de `git commit` / `git push` aunque un hook diga
//     `allow`, también dentro de una cadena (`a && git push`);
//   - el hook `PreToolUse` de la guarda: ve lo que un permiso por prefijo no ve (`git -C . push`,
//     `bash -c "git push"`) y bloquea el push forzado, los secretos y los borrados fuera del proyecto.
// `ask` y nunca `deny` (R16): si el usuario lo ordena, aprueba el aviso y se hace.
//
// Lo de chalc se reconoce por IGUALDAD exacta: lo que se parece pero no es idéntico es del usuario y no
// se toca. Lo del usuario conserva su orden; lo de chalc va al final.

import { isPlainObject } from '../catalog/gate/lib/data.mjs';

export const GUARD_COMMAND = 'node .chalc/gate/guard.mjs';
// El mismo texto que `.chalc/gate-hook.md` manda pegar: quien ya lo pegó a mano no recibe un segundo grupo.
export const GUARD_MATCHER = 'Bash|Read|Grep|Glob|NotebookRead';
export const GUARD_ASK = Object.freeze(['Bash(git commit *)', 'Bash(git push *)']);
// Aprobar la spec y el cierre es del usuario, desde su terminal (spec 024, R15; spec 028, R6): aquí sí es
// `deny`. No hay orden del usuario que el asistente pueda cumplir por él; lo que se le pide es justo que lo
// haga la persona.
// Y la fusión de la rama de integración (spec 035, R11): fusionarla es aprobar el cierre.
export const GUARD_DENY = Object.freeze(['Bash(node .chalc/gate.mjs --approve-spec*)', 'Bash(node .chalc/gate.mjs --approve-feature*)', 'Bash(git merge chalc/int-*)']);
// Las listas de `permissions` que chalc extiende, con sus reglas.
const GUARD_PERMISSIONS = Object.freeze({ ask: GUARD_ASK, deny: GUARD_DENY });

const guardGroup = () => ({ matcher: GUARD_MATCHER, hooks: [{ type: 'command', command: GUARD_COMMAND }] });

const isGuardHook = (hook) => isPlainObject(hook) && hook.type === 'command' && hook.command === GUARD_COMMAND;
const isGuardGroup = (group) => isPlainObject(group) && group.matcher === GUARD_MATCHER
  && Array.isArray(group.hooks) && group.hooks.some(isGuardHook);

// Un JSON válido con otra forma (`permissions` como lista, `ask` como texto…) no se puede extender sin
// pisar algo del usuario: se deja como está.
const objectOrMissing = (value) => value === undefined || isPlainObject(value);
const listOrMissing = (value) => value === undefined || Array.isArray(value);
const extensible = (settings) => isPlainObject(settings)
  && objectOrMissing(settings.permissions) && listOrMissing(settings.permissions?.ask) && listOrMissing(settings.permissions?.deny)
  && objectOrMissing(settings.hooks) && listOrMissing(settings.hooks?.PreToolUse);

/** El objeto con la guarda activa: `{ settings, changed }`, o null si su forma no se puede extender. No muta la entrada. */
export function withGuard(settings) {
  if (!extensible(settings)) return null;
  const out = structuredClone(settings);
  let changed = false;
  for (const [key, rules] of Object.entries(GUARD_PERMISSIONS)) {
    const list = out.permissions?.[key] ?? [];
    const missing = rules.filter((rule) => !list.includes(rule));
    // Sin reglas que falten, la lista queda igual: no hace falta otra rama.
    out.permissions = { ...out.permissions, [key]: [...list, ...missing] };
    changed = changed || missing.length > 0;
  }
  const preToolUse = out.hooks?.PreToolUse ?? [];
  const missingHook = !preToolUse.some(isGuardGroup);
  if (missingHook) out.hooks = { ...out.hooks, PreToolUse: [...preToolUse, guardGroup()] };
  return { settings: out, changed: changed || missingHook };
}

// El grupo de la guarda pierde solo el hook de chalc: si el usuario le añadió otro, el grupo sigue con el
// suyo. Un grupo que queda sin hooks desaparece (lista vacía, para `flatMap`); cualquier otra entrada sigue.
const groupWithoutGuard = (group) => {
  if (!isGuardGroup(group)) return [group];
  const hooks = group.hooks.filter((hook) => !isGuardHook(hook));
  return hooks.length ? [{ ...group, hooks }] : [];
};

// Deja `list` en `out[section][key]`. Lo que la retirada deja vacío se borra; lo que ya venía vacío no
// llega aquí, porque solo se llama cuando algo se quitó.
function replaceList(out, section, key, list) {
  if (list.length) { out[section][key] = list; return; }
  delete out[section][key];
  if (!Object.keys(out[section]).length) delete out[section];
}

/** El objeto sin lo que chalc añadió: `{ settings, changed }`, o null si su forma no se puede leer. No muta la entrada. */
export function withoutGuard(settings) {
  if (!extensible(settings)) return null;
  const out = structuredClone(settings);
  let changed = false;
  for (const [key, rules] of Object.entries(GUARD_PERMISSIONS)) {
    // Si retirar la lista anterior dejó `permissions` vacío y se borró, aquí ya no hay nada que quitar.
    const list = out.permissions?.[key] ?? [];
    const kept = list.filter((rule) => !rules.includes(rule));
    if (kept.length === list.length) continue;
    replaceList(out, 'permissions', key, kept);
    changed = true;
  }
  const preToolUse = out.hooks?.PreToolUse ?? [];
  const hooksChanged = preToolUse.some(isGuardGroup);
  if (hooksChanged) replaceList(out, 'hooks', 'PreToolUse', preToolUse.flatMap(groupWithoutGuard));
  return { settings: out, changed: changed || hooksChanged };
}
