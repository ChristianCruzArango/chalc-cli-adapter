import test from 'node:test';
import assert from 'node:assert/strict';
import { featureHandoff } from '../lib/commands/feature.mjs';
import { DICT } from '../lib/i18n.mjs';

const base = {
  backPath: 'C:/repos/api', backRel: 'specs/004-login',
  frontPath: 'C:/repos/web', frontRel: 'specs/004-login',
  branch: 'feat/login', backBranchCreated: true, frontBranchCreated: true
};

// R8 — sin móvil el hand-off sigue siendo el de DOS repos (retrocompatibilidad, R10).
test('featureHandoff without mobile keeps the two-repo orchestrator message', () => {
  const msg = featureHandoff({ ...base, specLang: 'español' });
  assert.match(msg, /DOS repos/);
  assert.doesNotMatch(msg, /MÓVIL|MOBILE/);
});

// R8 — con móvil: TRES repos, el móvil listado con su spec y orquestado después del front.
test('featureHandoff with mobile coordinates three repos, mobile after front (es)', () => {
  const msg = featureHandoff({
    ...base, specLang: 'español',
    mobilePath: 'C:/repos/app', mobileRel: 'specs/004-login', mobileBranchCreated: true
  });
  assert.match(msg, /TRES repos/);
  assert.match(msg, /MÓVIL \(consume la API\):\s+`C:\/repos\/app`/);
  assert.ok(msg.indexOf('FRONTEND') < msg.indexOf('MÓVIL (consume la API)'), 'el móvil va después del front');
  // el paso del móvil consume el MISMO contrato y no duplica lógica
  assert.match(msg, /MÓVIL[\s\S]*mismo contrato/i);
});

test('featureHandoff with mobile in English mentions THREE repos and the MOBILE side', () => {
  const msg = featureHandoff({
    ...base, specLang: 'English',
    mobilePath: 'C:/repos/app', mobileRel: 'specs/004-login', mobileBranchCreated: true
  });
  assert.match(msg, /THREE repos/);
  assert.match(msg, /MOBILE \(consumes the API\)/);
});

// R8 — la nota de rama cubre el estado mixto también con móvil.
test('featureHandoff branch note reflects partial creation across the three repos', () => {
  const msg = featureHandoff({
    ...base, specLang: 'español', frontBranchCreated: false,
    mobilePath: 'C:/repos/app', mobileRel: 'specs/004-login', mobileBranchCreated: true
  });
  assert.match(msg, /donde falte/);
});

// R9 — textos nuevos del flujo móvil existen en ambos idiomas (la paridad global la vigila i18n.test.mjs).
test('mobile flow i18n keys exist in es and en', () => {
  for (const key of ['featHasMobileQ', 'featMobilePathQ', 'featDetectMobile', 'sideMobile']) {
    assert.ok(key in DICT.es, `falta ${key} en es`);
    assert.ok(key in DICT.en, `falta ${key} en en`);
    assert.equal(typeof DICT.es[key], typeof DICT.en[key], `tipo distinto para ${key}`);
  }
  assert.equal(typeof DICT.es.featDetectMobile, 'function');   // recibe la etiqueta del stack
});

// R9 — los textos de progreso/cierre reflejan si hay móvil (no mienten con 3 repos).
test('featOrchestrating and featDone mention the mobile spec only when present', () => {
  for (const d of [DICT.es, DICT.en]) {
    assert.match(d.featOrchestrating(true), /m[óo]vil|mobile/i);
    assert.doesNotMatch(d.featOrchestrating(false), /m[óo]vil|mobile/i);
    assert.match(d.featDone(true), /m[óo]vil|mobile/i);
    assert.doesNotMatch(d.featDone(false), /m[óo]vil|mobile/i);
  }
});
