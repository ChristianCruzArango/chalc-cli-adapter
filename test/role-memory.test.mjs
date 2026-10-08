// spec 015 · T7, T10 (R14, R17) — los roles aprenden y respetan la memoria.
//
// Dos direcciones. Hacia la memoria: cuando un hallazgo o un bug enseña algo que vale para otras
// specs, el rol lo deja como `Regla aprendida`, con un concepto de la lista existente —si inventara
// el suyo, «money» y «dinero» volverían a ser dos cosas—. Desde la memoria: cada regla que el advisor
// le entregó tiene que confirmarla en su entrada, o la tarea no cierra.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENTS_DIR } from '../lib/roles.mjs';

const ROLES = ['seguridad', 'revisor', 'endurecedor'];
const prompt = (role, code) => readFile(join(AGENTS_DIR, role, code === 'es' ? 'agent.md' : 'agent.en.md'), 'utf8');

test('R14: every review role knows how to leave a learned rule, with a concept from the existing list', async () => {
  for (const role of ROLES) {
    const es = await prompt(role, 'es');
    assert.match(es, /Regla aprendida \(<concepto>(; sinónimos: [^)]*)?\): <regla>/, `${role}/es`);
    assert.match(es, /node \.chalc\/memory\.mjs concepts/, `${role}/es`);

    const en = await prompt(role, 'en');
    assert.match(en, /Learned rule \(<concept>(; synonyms: [^)]*)?\): <rule>/, `${role}/en`);
    assert.match(en, /node \.chalc\/memory\.mjs concepts/, `${role}/en`);
  }
});

// Una regla que solo vale para esta línea de código no es memoria del proyecto: es un hallazgo.
test('R14: the roles are told a learned rule must apply beyond this task', async () => {
  for (const role of ROLES) {
    assert.match(await prompt(role, 'es'), /otras specs/, `${role}/es`);
    assert.match(await prompt(role, 'en'), /other specs/, `${role}/en`);
  }
});

test('R17: every review role confirms each rule it received, in a fixed format', async () => {
  for (const role of ROLES) {
    const es = await prompt(role, 'es');
    assert.match(es, /- Regla <id>: cumple — <archivo:línea>/, `${role}/es`);
    assert.match(es, /no cumple/, `${role}/es`);
    assert.match(es, /no aplica — <motivo>/, `${role}/es`);

    const en = await prompt(role, 'en');
    assert.match(en, /- Rule <id>: complies — <file:line>/, `${role}/en`);
    assert.match(en, /violates/, `${role}/en`);
    assert.match(en, /n\/a — <reason>/, `${role}/en`);
  }
});

// Un sinónimo mal dado ensucia el concepto para todo el repo: «envío» como dinero haría que cualquier
// spec de envíos recibiera reglas de dinero.
test('R14: the roles are told a synonym must always mean the concept in this project', async () => {
  for (const role of ROLES) {
    assert.match(await prompt(role, 'es'), /siempre significan/, `${role}/es`);
    assert.match(await prompt(role, 'en'), /always mean/, `${role}/en`);
  }
});
