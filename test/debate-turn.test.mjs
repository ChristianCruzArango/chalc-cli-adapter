// test/debate-turn.test.mjs — specs/014-debate R10 (formato del turno) y R12 (acuerdo justificado).
//
// R12 es la mitigación central de la feature: la literatura de multi-agent debate señala la
// conformidad —ceder ante el argumento ajeno para no discrepar— como el fallo dominante, capaz de
// dejar el debate por debajo de un solo modelo. Aquí se decide QUÉ cuenta como acuerdo, y se decide
// leyendo el turno, no confiando en que el modelo se porte bien.

import test from 'node:test';
import assert from 'node:assert/strict';
import { TURN_SECTIONS, turnFormatBlock } from '../lib/debate/sections.mjs';
import { isJustifiedAgreement, parseTurn } from '../lib/debate/turn.mjs';

const TURNO_COMPLETO = `===POSTURA===
Mantengo la cola de eventos: desacopla el pico de carga.

===ACUERDOS===
- El esquema de reintentos hace falta.

===DESACUERDOS===
- D1: el coste de operación de la cola no está medido.
- D2: no hay plan de reproceso para mensajes muertos.

===RESUELTOS===
- D3: la latencia deja de ser objeción porque el pico se absorbe en la cola, no en el request.

===PREGUNTAS_USUARIO===
- ¿Qué volumen diario de mensajes esperas?

===ESTADO===
acuerdo: no`;

const meta = { round: 1, by: 'a', stance: 'proponent' };

// ── T3 · el contrato de secciones es único ─────────────────────────────────────────────────────
test('el bloque de formato de los prompts nombra EXACTAMENTE las secciones que el parser lee (R10)', () => {
  const bloque = turnFormatBlock();
  for (const name of TURN_SECTIONS) assert.ok(bloque.includes(`===${name}===`), `falta ${name} en el bloque`);
  // y al revés: ninguna marca del bloque que el parser no conozca
  const enBloque = [...bloque.matchAll(/===([A-Z0-9_]+)===/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(enBloque)].sort(), [...TURN_SECTIONS].sort());
});

// ── T4 · parseTurn ─────────────────────────────────────────────────────────────────────────────
test('parseTurn extrae postura, listas y estado de un turno completo (R10)', () => {
  const t = parseTurn(TURNO_COMPLETO, meta);
  assert.match(t.postura, /cola de eventos/);
  assert.deepEqual(t.acuerdos, ['El esquema de reintentos hace falta.']);
  assert.equal(t.desacuerdos.length, 2);
  assert.match(t.desacuerdos[0], /coste de operación/);
  assert.equal(t.preguntas.length, 1);
  assert.equal(t.declaraAcuerdo, false);
  assert.equal(t.round, 1);
  assert.equal(t.by, 'a');
  assert.equal(t.raw, TURNO_COMPLETO);   // el transcript necesita el original íntegro
});

test('parseTurn acepta viñetas con -, * y numeradas, y descarta las líneas vacías', () => {
  const t = parseTurn('===DESACUERDOS===\n- uno\n* dos\n1. tres\n\n   \n', meta);
  assert.deepEqual(t.desacuerdos, ['uno', 'dos', 'tres']);
});

test('parseTurn sin viñetas toma cada línea como un ítem', () => {
  const t = parseTurn('===PREGUNTAS_USUARIO===\n¿cuántos usuarios?\n¿qué presupuesto?', meta);
  assert.deepEqual(t.preguntas, ['¿cuántos usuarios?', '¿qué presupuesto?']);
});

test('parseTurn reconoce el acuerdo escrito de varias formas y no lo confunde con "no" (R10)', () => {
  const si = ['acuerdo: si', 'acuerdo: sí', 'Acuerdo:  SÍ', 'acuerdo: yes'];
  for (const linea of si) assert.equal(parseTurn(`===ESTADO===\n${linea}`, meta).declaraAcuerdo, true, linea);
  const no = ['acuerdo: no', 'acuerdo: todavía no', 'acuerdo:no', ''];
  for (const linea of no) assert.equal(parseTurn(`===ESTADO===\n${linea}`, meta).declaraAcuerdo, false, linea);
});

test('parseTurn con respuesta truncada conserva lo recibido y NO declara acuerdo (R10)', () => {
  const t = parseTurn('===POSTURA===\nmi argumento entero\n===DESACUER', meta);
  assert.equal(t.postura, 'mi argumento entero');
  assert.deepEqual(t.desacuerdos, []);
  assert.equal(t.declaraAcuerdo, false);   // un turno ilegible jamás cierra un debate
});

test('parseTurn con basura, vacío o null no lanza: devuelve un turno vacío', () => {
  for (const raw of ['', null, undefined, 'me parece bien todo']) {
    const t = parseTurn(raw, meta);
    assert.equal(t.declaraAcuerdo, false);
    assert.deepEqual(t.desacuerdos, []);
  }
});

// ── T5 · el acuerdo hay que ganárselo ──────────────────────────────────────────────────────────
// Los desacuerdos abiertos llevan SU número: el mismo que el motor le enseñó al modelo en el prompt.
// Sin número explícito, dos módulos tendrían que numerar igual por su cuenta para entenderse.
const abiertos = [{ n: 1, texto: 'el coste de operación no está medido' }, { n: 2, texto: 'no hay plan de reproceso' }];

test('sin declarar acuerdo no hay acuerdo, por muy resueltos que cite (R12)', () => {
  const t = parseTurn('===RESUELTOS===\n- D1: quedó claro con el número de ayer\n===ESTADO===\nacuerdo: no', meta);
  assert.equal(isJustifiedAgreement(t, abiertos), false);
});

test('acuerdo declarado SIN resueltos = complacencia: no cuenta (R12)', () => {
  const t = parseTurn('===POSTURA===\nMe convence.\n===ESTADO===\nacuerdo: si', meta);
  assert.equal(isJustifiedAgreement(t, abiertos), false);
});

test('acuerdo que cita un desacuerdo que NO está abierto no cuenta (R12)', () => {
  const t = parseTurn('===RESUELTOS===\n- D7: aquello se resolvió porque cambiamos el diseño entero\n===ESTADO===\nacuerdo: si', meta);
  assert.equal(isJustifiedAgreement(t, abiertos), false);
});

test('acuerdo que cita un desacuerdo abierto pero sin porqué no cuenta (R12)', () => {
  const t = parseTurn('===RESUELTOS===\n- D1: ok\n===ESTADO===\nacuerdo: si', meta);
  assert.equal(isJustifiedAgreement(t, abiertos), false);
});

test('acuerdo que cita un desacuerdo abierto y explica por qué SÍ cuenta (R12)', () => {
  const t = parseTurn('===RESUELTOS===\n- D2: el reproceso queda cubierto por la cola de mensajes muertos que acordamos\n===ESTADO===\nacuerdo: si', meta);
  assert.equal(isJustifiedAgreement(t, abiertos), true);
});

test('sin nada en disputa, el acuerdo no necesita justificarse (R12)', () => {
  // Si no queda ningún desacuerdo abierto no hay nada que ceder: exigir una cita sería pedir que se
  // justifique lo que ya no existe, y el debate no cerraría nunca. Que NO haya habido disenso en
  // todo el debate es harina de otro costal — eso lo vigila el motor, no el formato de un turno.
  const t = parseTurn('===ESTADO===\nacuerdo: si', meta);
  assert.equal(isJustifiedAgreement(t, []), true);
});
