// test/specgen.test.mjs — specgen arma el prompt que se envía a la IA (cuesta tokens reales):
// estas pruebas fijan el contrato del prompt y del parseo SIN llamar a ningún modelo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseDelimited } from '../lib/specgen.mjs';

const FULL_RESPONSE = [
  '===FEATURE===', 'crear-usuario',
  '===SPEC===', '# Spec', 'WHEN el usuario envía el formulario THE SYSTEM SHALL crear la cuenta.',
  '===PLAN===', '# Plan', 'Arquitectura hexagonal.',
  '===TASKS===', '- [ ] T1 (R1)'
].join('\n');

test('parseDelimited extrae las cuatro secciones de una respuesta completa', () => {
  const r = parseDelimited(FULL_RESPONSE);
  assert.equal(r.feature, 'crear-usuario');
  assert.match(r.files['spec.md'], /THE SYSTEM SHALL/);
  assert.match(r.files['plan.md'], /hexagonal/);
  assert.match(r.files['tasks.md'], /T1 \(R1\)/);
});

test('parseDelimited conserva las secciones ya recibidas si la respuesta se truncó', () => {
  const truncada = FULL_RESPONSE.split('===TASKS===')[0];
  const r = parseDelimited(truncada);
  assert.match(r.files['spec.md'], /THE SYSTEM SHALL/);
  assert.match(r.files['plan.md'], /hexagonal/);
  assert.equal(r.files['tasks.md'], '');   // lo truncado queda vacío, no revienta
});

test('parseDelimited quita el cercado ``` que el modelo a veces agrega a una sección', () => {
  const r = parseDelimited('===SPEC===\n```markdown\n# Spec cercado\n```\n===PLAN===\nplan');
  assert.equal(r.files['spec.md'], '# Spec cercado');
  assert.equal(r.files['plan.md'], 'plan');
});

test('parseDelimited con basura o vacío devuelve secciones vacías sin lanzar', () => {
  for (const raw of ['', null, undefined, 'texto sin marcas']) {
    const r = parseDelimited(raw);
    assert.equal(r.feature, '');
    assert.equal(r.files['spec.md'], '');
  }
});

test('parseDelimited acepta marcas con espacios y en minúsculas (===  spec  ===)', () => {
  const r = parseDelimited('=== spec ===\ncontenido spec\n=== PLAN ===\ncontenido plan');
  assert.equal(r.files['spec.md'], 'contenido spec');
  assert.equal(r.files['plan.md'], 'contenido plan');
});

// Anti-drift del prompt: si alguien agrega ${NUEVA_VAR} a spec-gen.prompt.xml sin actualizar
// buildPrompt, inject lanza — este test lo captura ANTES de gastar tokens en una llamada rota.
test('buildPrompt resuelve TODOS los placeholders de la plantilla XML', async () => {
  const { system, user } = await buildPrompt({
    language: 'English', mode: 'full', documentText: 'HU: como usuario quiero X',
    templates: { spec: 'S-TPL', plan: 'P-TPL', tasks: 'T-TPL' }, constitution: 'C-1'
  });
  assert.doesNotMatch(system, /\$\{\w+\}/);   // ninguna variable quedó sin inyectar
  for (const v of ['English', 'full', 'S-TPL', 'P-TPL', 'T-TPL', 'C-1']) assert.ok(system.includes(v), `falta ${v} en el system`);
  assert.equal(user, '<source_document>\nHU: como usuario quiero X\n</source_document>');
});

test('buildPrompt aplica defaults seguros cuando faltan opciones', async () => {
  const { system } = await buildPrompt({ documentText: 'doc' });
  assert.ok(system.includes('español'));                      // idioma por defecto
  assert.ok(system.includes('lite'));                         // modo por defecto
  assert.ok(system.includes('(sin constitución provista)'));  // constitución ausente, explícita
  assert.doesNotMatch(system, /\$\{\w+\}/);
});
