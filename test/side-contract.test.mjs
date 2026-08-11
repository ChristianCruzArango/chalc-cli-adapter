// T1 (R1, R5) — dos copias del contrato que deberían ser idénticas.
//
// `chalc feature` copia el MISMO contrato dentro de la spec de cada lado. Cuando el back lo cambia a
// media feature, edita su copia y sigue; las otras se quedan viejas y el front implementa contra algo
// que ya no existe. Hoy se entera al integrar, o cuando el portón le falla la etapa de contrato — que
// solo detecta rutas desaparecidas, no cambios de forma ni de código de error.
//
// Dos archivos que deberían coincidir y no coinciden es un hecho comprobable. Esta es la parte de la
// spec 010 que no depende de que nadie se acuerde de avisar.
//
// La regla que más importa aquí es R5: se compara el CONTENIDO, nunca la fecha. Equipar reescribe
// archivos y toca mtimes; un aviso que salta cuando no ha pasado nada se aprende a ignorar en dos
// días, y entonces no sirve para el día que sí pasa.

import test from 'node:test';
import assert from 'node:assert/strict';
import { contractDrift } from '../catalog/next/lib/contract.mjs';

const CONTRATO = [
  '# Contrato de API',
  '',
  '## POST /pagos',
  '- 201 → { id, estado }',
  '- 422 → { error }'
].join('\n');

// ── sin deriva ────────────────────────────────────────────────────────────────────────────────

test('R1 — dos copias idénticas no son deriva', () => {
  assert.equal(contractDrift(CONTRATO, CONTRATO).differs, false);
});

test('R5 — el mismo texto con distinto final de línea no es deriva', () => {
  // Windows y Linux en el mismo workspace es lo normal, no una anomalía.
  assert.equal(contractDrift(CONTRATO, CONTRATO.replace(/\n/g, '\r\n')).differs, false);
});

test('R5 — espacios finales y una línea en blanco de más no son deriva', () => {
  const conRuido = CONTRATO.split('\n').map((l) => l + '  ').join('\n') + '\n\n';
  assert.equal(contractDrift(CONTRATO, conRuido).differs, false);
});

test('R5 — la comparación es de contenido: la función ni siquiera recibe fechas', () => {
  assert.equal(contractDrift.length, 2, 'contractDrift(mío, suyo) — nada de mtimes');
});

// ── con deriva ────────────────────────────────────────────────────────────────────────────────

test('R1 — un código de error cambiado SÍ es deriva', () => {
  // Es justo el caso que el portón no ve: la ruta sigue ahí, la forma cambió.
  const cambiado = CONTRATO.replace('422', '409');
  const drift = contractDrift(CONTRATO, cambiado);

  assert.equal(drift.differs, true);
  assert.ok(drift.lines > 0, 'tiene que decir cuánto cambió');
});

test('R1 — un campo nuevo en la respuesta es deriva', () => {
  const cambiado = CONTRATO.replace('{ id, estado }', '{ id, estado, referencia }');
  assert.equal(contractDrift(CONTRATO, cambiado).differs, true);
});

test('R1 — una ruta nueva es deriva, y cuenta las líneas añadidas', () => {
  const cambiado = `${CONTRATO}\n\n## GET /pagos/{id}\n- 200 → { id, estado }`;
  const drift = contractDrift(CONTRATO, cambiado);

  assert.equal(drift.differs, true);
  assert.equal(drift.lines, 3);
});

test('R1 — el recuento no depende del orden de los argumentos', () => {
  const cambiado = `${CONTRATO}\n- 500 → { error }`;

  assert.equal(contractDrift(CONTRATO, cambiado).lines, contractDrift(cambiado, CONTRATO).lines);
});

// ── lo que falta ──────────────────────────────────────────────────────────────────────────────

test('R11 — sin contrato en alguno de los dos lados no hay nada que comparar', () => {
  assert.equal(contractDrift('', CONTRATO).differs, false);
  assert.equal(contractDrift(CONTRATO, '').differs, false);
  assert.equal(contractDrift(null, undefined).differs, false);
});

test('R11 — un contrato que solo tiene espacios cuenta como ausente', () => {
  assert.equal(contractDrift('   \n\n  ', CONTRATO).differs, false);
});

test('R1 — añadir una línea que ya aparecía en otro sitio también es deriva, y cuenta', () => {
  // Con recuento por conjunto se perdería: la línea ya estaba, así que "no habría nada nuevo".
  const conRepetida = `${CONTRATO}\n- 422 → { error }`;
  const drift = contractDrift(CONTRATO, conRepetida);

  assert.equal(drift.differs, true);
  assert.equal(drift.lines, 1, 'la repetición cuenta como una línea de diferencia');
});
