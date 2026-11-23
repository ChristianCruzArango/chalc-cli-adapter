// Spec 024 (coherencia), T2 — huella de HU+spec+plan+tareas (R10): marcar casillas no la cambia; editar
// cualquier texto sí. Pura y estable entre sistemas (fin de línea de Windows incluido).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { huHash, specFingerprint } from '../catalog/gate/lib/specprint.mjs';

const SET = { 'hu.md': 'Como usuario quiero pagar', 'spec.md': '**R1** — WHEN x THE SYSTEM SHALL y', 'plan.md': 'plan', 'tasks.md': '- [ ] **T1** (R1) — a\n- [ ] **T2** (R1) — b\n' };
const withFile = (name, text) => ({ ...SET, [name]: text });

test('R10: la huella son 16 hex del sha256 de hu, spec, plan y tareas separados por NUL', () => {
  const expected = createHash('sha256').update(['Como usuario quiero pagar', SET['spec.md'], 'plan', SET['tasks.md']].join('\0')).digest('hex').slice(0, 16);
  assert.equal(specFingerprint(SET), expected);
  assert.match(specFingerprint(SET), /^[0-9a-f]{16}$/);
});

test('R10: marcar o desmarcar casillas de tasks.md no cambia la huella', () => {
  const base = specFingerprint(SET);
  assert.equal(specFingerprint(withFile('tasks.md', '- [x] **T1** (R1) — a\n- [X] **T2** (R1) — b\n')), base);
  assert.equal(specFingerprint(withFile('tasks.md', '* [x] **T1** (R1) — a\n- [ ] **T2** (R1) — b\n')) === base, false, 'otra viñeta sí es otro texto');
});

test('R10: una casilla fuera de tasks.md sí cuenta como contenido', () => {
  assert.notEqual(specFingerprint(withFile('plan.md', '- [x] hecho')), specFingerprint(withFile('plan.md', '- [ ] hecho')));
});

test('R10: editar el texto de cualquiera de los cuatro archivos cambia la huella', () => {
  const base = specFingerprint(SET);
  for (const name of Object.keys(SET)) assert.notEqual(specFingerprint(withFile(name, SET[name] + ' cambio')), base, name);
});

test('R10: mover texto de un archivo al siguiente cambia la huella (el separador importa)', () => {
  assert.notEqual(specFingerprint({ ...SET, 'hu.md': 'ab', 'spec.md': 'c' }), specFingerprint({ ...SET, 'hu.md': 'a', 'spec.md': 'bc' }));
});

test('R10: el fin de línea de Windows y un archivo ausente no alteran la huella', () => {
  const crlf = Object.fromEntries(Object.entries(SET).map(([k, v]) => [k, v.replace(/\n/g, '\r\n')]));
  assert.equal(specFingerprint(crlf), specFingerprint(SET));
  assert.equal(specFingerprint(withFile('plan.md', null)), specFingerprint(withFile('plan.md', '')));
  assert.equal(specFingerprint({}), specFingerprint({ 'hu.md': '', 'spec.md': '', 'plan.md': '', 'tasks.md': '' }));
});

test('R8: huHash es el sha256 completo del texto de la HU, sin depender del fin de línea', () => {
  assert.equal(huHash('a\nb'), createHash('sha256').update('a\nb').digest('hex'));
  assert.equal(huHash('a\r\nb'), huHash('a\nb'));
  assert.notEqual(huHash('a\nb'), huHash('a\nc'));
  assert.equal(huHash(null), huHash(''));
});
