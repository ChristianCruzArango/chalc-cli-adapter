// spec 014 · T1 (R16) — el vocabulario de la etapa de seguridad.
//
// La etapa `security` emite datos y el marco redacta, igual que el resto del portón. Estos tests
// fijan que cada regla nueva exista con su código estable y que su frase diga QUÉ HACER: un
// "secreto en el código" a secas no le dice al modelo que lo mueva a configuración.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME, messageOf } from '../catalog/gate/lib/i18n.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';

// Pares [clave en RULES, código]. El código va escrito a mano a propósito: es el valor que se fija.
const SECURITY_PAIRS = [
  ['hardcodedSecret', 'hardcoded-secret'], ['tlsDisabled', 'tls-disabled'],
  ['insecureTransport', 'insecure-transport'], ['sqlConcat', 'sql-concat'],
  ['dynamicEval', 'dynamic-eval'], ['unsafeHtml', 'unsafe-html'],
  ['weakHash', 'weak-hash'], ['allowWithoutReason', 'allow-without-reason']
];
const SECURITY = Object.fromEntries(SECURITY_PAIRS);

// Los códigos son contrato: la evidencia los muestra y `chalc-allow: <regla>` los cita a mano. Si
// cambiaran, las supresiones que ya hay en los repos dejarían de casar sin avisar.
test('R16: the gate names every security rule with a stable code', async () => {
  for (const [key, code] of SECURITY_PAIRS) {
    assert.equal(RULES[key], code, `RULES.${key}`);
  }
});

test('R16: every security finding is worded differently in es and en', async () => {
  for (const code of Object.values(SECURITY)) {
    const es = messageOf(code, { rule: 'weak-hash', match: 'md5' }, 'es');
    const en = messageOf(code, { rule: 'weak-hash', match: 'md5' }, 'en');

    assert.notEqual(es, code, `"${code}" sin redactar en es`);
    assert.notEqual(en, code, `"${code}" sin redactar en en`);
    assert.notEqual(es, en, `"${code}" dice lo mismo en los dos idiomas`);
  }
});

// Cada frase lleva la salida: dónde va el secreto, qué API usar, cómo justificar una excepción.
test('R16: the security findings say how to fix them', async () => {
  const fixes = {
    es: {
      [SECURITY.hardcodedSecret]: /entorno|configuración/,
      [SECURITY.tlsDisabled]: /certificado/,
      [SECURITY.insecureTransport]: /https/,
      [SECURITY.sqlConcat]: /parámetros/,
      [SECURITY.dynamicEval]: /código/,
      [SECURITY.unsafeHtml]: /escap|textContent/,
      [SECURITY.weakHash]: /SHA-256|bcrypt|argon2/,
      [SECURITY.allowWithoutReason]: /motivo/
    },
    en: {
      [SECURITY.hardcodedSecret]: /environment|configuration/,
      [SECURITY.tlsDisabled]: /certificate/,
      [SECURITY.insecureTransport]: /https/,
      [SECURITY.sqlConcat]: /parameters/,
      [SECURITY.dynamicEval]: /code/,
      [SECURITY.unsafeHtml]: /escap|textContent/,
      [SECURITY.weakHash]: /SHA-256|bcrypt|argon2/,
      [SECURITY.allowWithoutReason]: /reason/
    }
  };

  for (const [lang, table] of Object.entries(fixes)) {
    for (const [code, pattern] of Object.entries(table)) {
      assert.match(messageOf(code, { rule: 'weak-hash', match: 'md5' }, lang), pattern, `${code} (${lang})`);
    }
  }
});

// La supresión sin motivo cita la regla que intentaba silenciar: sin ella no se sabe cuál arreglar.
test('R16: an allow without a reason names the rule it tried to silence', async () => {
  for (const lang of ['es', 'en']) {
    assert.match(messageOf(SECURITY.allowWithoutReason, { rule: 'tls-disabled' }, lang), /tls-disabled/);
  }
});

// La etapa aparece en la tabla del informe con su nombre, no con el identificador interno.
test('R16: the report names the security stage in both languages', async () => {
  assert.equal(typeof FRAME.es.stages.security, 'string');
  assert.equal(typeof FRAME.en.stages.security, 'string');
  assert.notEqual(FRAME.es.stages.security, FRAME.en.stages.security);
});
