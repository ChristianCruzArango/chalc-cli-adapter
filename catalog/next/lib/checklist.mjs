// checklist.mjs — la checklist de una revisión (spec 014, R28, R29). Responsabilidad ÚNICA: decir qué
// le falta a la checklist de una entrada de la bitácora. Razón de cambio: qué categorías exige cada
// tipo de checklist y qué cuenta como haberlas revisado.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Un `OK` a secas no prueba que se revisó nada. Con la checklist, cada categoría dice qué se miró
// (`revisado — archivo:línea`) o por qué no aplica (`no aplica — motivo`), y eso SÍ se puede comprobar
// sin entender el código: que estén todas, que lo revisado sean líneas de la tarea y que lo que no
// aplica lo explique.
//
// Puro: recibe la entrada ya leída y los hechos del repo, devuelve problemas. No conoce ningún rol: la
// checklist la declara el contrato del rol.

const OWASP = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'];
const MASVS = ['STORAGE', 'CRYPTO', 'AUTH', 'NETWORK', 'PLATFORM', 'CODE', 'RESILIENCE', 'PRIVACY'].map((g) => `MASVS-${g}`);

// Lo que exige cada tipo de checklist: siempre, y además en un repo móvil.
const KINDS = { owasp: { always: OWASP, mobile: MASVS } };

const MIN_WORDS = 3;
const words = (text) => String(text ?? '').split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
const fileOf = (ref) => ref.replace(/:\d+$/, '').replace(/\\/g, '/');

// Lo que falla en UNA categoría, o null.
function categoryProblem(id, item, scope) {
  if (!item) return `${id}: missing`;
  if (item.status === 'reviewed' && !item.refs.some((ref) => scope.has(fileOf(ref)))) {
    return `${id}: reviewed without file:line from the task`;
  }
  if (item.status === 'na' && words(item.reason) < MIN_WORDS) return `${id}: not applicable without a reason`;
  return null;
}

// Lo que falla en la confirmación de UNA regla entregada, o null (spec 015, R17).
function confirmationProblem(id, confirmation) {
  if (!confirmation) return `${id}: not confirmed`;
  if (confirmation.status === 'na') return words(confirmation.reason) < MIN_WORDS ? `${id}: not applicable without a reason` : null;
  return confirmation.refs.length ? null : `${id}: ${confirmation.status} without file:line`;
}

// Las reglas entregadas por la memoria que la entrada no confirma como se debe. Las decisiones no se
// confirman: se entregan para no volver a reportarlas. Y solo cuentan las reglas que ya existían
// cuando el rol revisó: la que nace de su propia revisión no se le puede exigir a esa revisión.
const knownAt = (rule, entry) => !rule.learned || Date.parse(rule.learned) < entry.date;

export const confirmationProblems = (entry, delivered = []) => delivered
  .filter((e) => e.kind !== 'decision' && knownAt(e, entry))
  .map((e) => confirmationProblem(e.id, entry.confirmations?.[e.id]))
  .filter(Boolean);

// Los problemas de la checklist de `entry`. Lista vacía = la checklist se sostiene.
export function checklistProblems(entry, { kind, mobile = false, scope = [] } = {}) {
  const spec = KINDS[kind];
  if (!spec) return [`unknown checklist "${kind}"`];

  const files = new Set(scope.map((f) => String(f).replace(/\\/g, '/')));
  const required = [...spec.always, ...(mobile ? spec.mobile : [])];
  const problems = required.map((id) => categoryProblem(id, entry.checklist?.[id], files)).filter(Boolean);

  // Con hallazgos, el número del encabezado es el de la lista: si no cuadra, uno de los dos miente.
  if (!entry.ok && entry.findings !== (entry.numbered ?? 0)) {
    problems.push(`FINDINGS: ${entry.findings} but ${entry.numbered ?? 0} numbered item(s)`);
  }
  return problems;
}
