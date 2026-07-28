import test from 'node:test';
import assert from 'node:assert/strict';
import { generateContract } from '../lib/contract.mjs';

// R4 — el contrato conoce el stack del móvil cuando hay app móvil.
test('generateContract injects the mobile stack into the system prompt', async () => {
  let seenSystem = '';
  const chatImpl = async (_cfg, { system }) => { seenSystem = system; return '## Requisitos compartidos\n- R1'; };

  await generateContract({}, {
    userStory: 'Como usuario quiero iniciar sesión.',
    backStack: 'NestJS', frontStack: 'Angular', mobileStack: 'Flutter + Dart', chatImpl
  });

  // se asserta el ELEMENTO <mobile> (no el texto suelto: "(sin app móvil)" también vive en los principios del prompt)
  assert.match(seenSystem, /<mobile>Flutter \+ Dart<\/mobile>/);
  assert.doesNotMatch(seenSystem, /\$\{MOBILE_STACK\}/);   // el placeholder quedó resuelto
});

// R4 — sin móvil, el prompt lo declara explícito para que la IA no invente clientes.
test('generateContract without mobile declares "(sin app móvil)" in the prompt', async () => {
  let seenSystem = '';
  const chatImpl = async (_cfg, { system }) => { seenSystem = system; return 'C'; };

  await generateContract({}, { userStory: 'HU', backStack: 'Go', frontStack: 'Angular', chatImpl });

  assert.match(seenSystem, /<mobile>\(sin app móvil\)<\/mobile>/);
});
