// lib/debate/turn.mjs — leer UN turno de debate y decidir si su acuerdo vale (spec 014, R10, R12).
// Responsabilidad ÚNICA: interpretar el texto de un turno. Razón de cambio: qué significa un turno.
//
// Aquí vive la mitigación central de la feature. El fallo dominante del debate entre modelos no es
// que no converjan: es que convergen por complacencia —ceden ante el argumento ajeno para no
// discrepar— y el resultado sale peor que preguntándole a uno solo. Pedirle al modelo en el prompt
// que "no ceda a la ligera" no sirve de nada: lo que no se comprueba, no ocurre. Por eso el acuerdo
// se VERIFICA leyendo el turno, y un turno que no lo demuestra no cierra nada.

import { parseSections } from '../promptkit.mjs';
import { TURN_SECTIONS } from './sections.mjs';

// Justificación mínima para dar por resuelto un desacuerdo. Un "ok" o un "vale" no son un porqué;
// el umbral es corto a propósito: filtra la conformidad de una palabra, no exige un ensayo.
const MIN_JUSTIFICACION = 12;

// Una lista del modelo: viñetas -, *, • o numeradas, o una línea por ítem si no puso viñetas.
function bullets(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim().replace(/^([-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

// "acuerdo: si|sí|yes|true" en la sección ESTADO. Cualquier otra cosa —incluido no haber respondido—
// es "no": ante la duda, el debate sigue. Cerrar de más es el error caro; seguir debatiendo, no.
function declaresAgreement(estado) {
  // El corte se hace con un lookahead de "no viene otra letra" y no con \b: en JS `\b` no ve la í de
  // "sí" como letra, así que un `sí` al final de línea no cerraría ningún debate en español.
  return /acuerdo\s*:\s*(s[ií]|yes|true)(?![\p{L}\p{N}])/iu.test(String(estado || ''));
}

/** Un turno crudo del modelo → objeto Turn. Nunca lanza: lo que no vino, viene vacío. */
export function parseTurn(raw, { round, by, stance } = {}) {
  const s = parseSections(raw, TURN_SECTIONS);
  return {
    round,
    by,
    stance,
    postura: s.POSTURA,
    acuerdos: bullets(s.ACUERDOS),
    desacuerdos: bullets(s.DESACUERDOS),
    resueltos: bullets(s.RESUELTOS),
    preguntas: bullets(s.PREGUNTAS_USUARIO),
    declaraAcuerdo: declaresAgreement(s.ESTADO),
    raw: String(raw ?? '')
  };
}

// "D2: porque el reproceso ya está cubierto" → { n: 2, why: 'porque el reproceso…' }.
// Sin número o sin porqué no es una cita: es una afirmación de que algo se resolvió, que es
// exactamente lo que no podemos aceptar sin comprobar.
function citations(resueltos = []) {
  return resueltos
    .map((item) => String(item).match(/^D\s*(\d+)\s*[:.\-–]\s*(.+)$/i))
    .filter(Boolean)
    .map((m) => ({ n: Number(m[1]), why: m[2].trim() }));
}

/**
 * Un desacuerdo que llega prefijado con la referencia a otro ("D2: no hay plan de reproceso") se parte
 * en la referencia y el texto limpio (R39).
 *
 * Los modelos numeran sus objeciones apuntando a la lista que se les enseñó, y ese prefijo no es parte
 * de la objeción: dejarlo dentro ensucia el informe y, peor, impide reconocer que la de esta ronda es
 * la misma de la anterior. Exige el número pegado al separador para no confundir con "D2C es un
 * formato de datos".
 */
export function splitRef(item) {
  const m = String(item || '').match(/^D\s*(\d+)\s*[:.\-–]\s*(.+)$/i);
  return m ? { ref: Number(m[1]), texto: m[2].trim() } : { ref: null, texto: String(item || '').trim() };
}

/**
 * Los desacuerdos abiertos que este turno da por resueltos CON razón suficiente.
 *
 * `openDisagreements` son `{ n, texto }` con el número que el motor le enseñó al modelo: se compara
 * contra ese número y no contra la posición en la lista, para que resolver uno no renumere a los
 * demás y convierta una cita antigua en otra cosa.
 */
export function resolvedRefs(turn, openDisagreements = []) {
  return citations(turn?.resueltos).filter(
    (c) => c.why.length >= MIN_JUSTIFICACION && openDisagreements.some((d) => d.n === c.n)
  );
}

/**
 * ¿El acuerdo que declara este turno está ganado? (R12)
 *
 * Cuenta solo si cita al menos un desacuerdo REALMENTE abierto y explica por qué deja de estarlo.
 * Citar uno inventado, o citarlo sin razón, es lo que hace un modelo que se rinde para agradar.
 *
 * Sin nada en disputa el acuerdo no necesita justificarse: no queda nada que ceder. Que en TODO el
 * debate no haya habido disenso es otro problema —y lo vigila el motor, que es quien ve el debate
 * entero; un turno solo se ve a sí mismo.
 */
export function isJustifiedAgreement(turn, openDisagreements = []) {
  if (!turn?.declaraAcuerdo) return false;
  if (!openDisagreements.length) return true;
  return resolvedRefs(turn, openDisagreements).length > 0;
}
