// lib/featureorch.mjs — orquestador neutral del flujo full-stack. Responsabilidad única: coordinar a los
// dos "agentes" (back y front) alrededor de UN contrato compartido. El back lidera el contrato; el front lo
// consume. Cada lado se especifica con el harness estricto de spec-gen (reúso), aterrizado en SU rol y stack.
// No decide por ningún lado (no es ni el front ni el back): solo reparte, comparte el contrato y junta.

import { generateContract } from './contract.mjs';
import { generateSpec } from './specgen.mjs';

// Documento fuente aumentado para un lado: rol + contrato autoritativo + HU. Se pasa a generateSpec como
// documentText; el harness de spec-gen lo trata como fuente. Mantiene R# compartidos para trazabilidad cruzada.
function roleDocument(side, stack, contract, userStory) {
  const isBack = side === 'BACKEND';
  return [
    `<role>${side}</role>`,
    `Estás especificando ÚNICAMENTE la parte ${isBack ? 'BACKEND' : 'FRONTEND'} de esta feature, para un stack ${stack || '(no detectado)'}.`,
    'La otra parte se especifica por separado. El CONTRATO de API de abajo es AUTORITATIVO: respétalo, no lo redefinas.',
    'Reutiliza los MISMOS identificadores de requisito (R1, R2, …) del contrato para conservar la trazabilidad cruzada.',
    isBack
      ? 'Incluye solo lo del backend: endpoints, modelo de datos, reglas de negocio, validación y persistencia.'
      : 'Incluye solo lo del frontend: pantallas, estado, navegación, validación de formularios y CONSUMO del contrato (no reimplementes la lógica del backend).',
    '',
    '<api_contract>',
    contract,
    '</api_contract>',
    '',
    '<user_story>',
    String(userStory || '').trim(),
    '</user_story>'
  ].join('\n');
}

// Orquesta el flujo: 1) contrato (back lidera) → 2) spec del back → 3) spec del front (consume el contrato).
// `back`/`front` = { stack, templates, constitution }. Impls inyectables para testear sin tokens.
// Devuelve { contract, contractTrace, back: <generateSpec>, front: <generateSpec> }.
export async function orchestrateFeature({
  cfg, userStory, language = 'español', mode = 'lite', back, front, backContext = '',
  generateContractImpl = generateContract, generateSpecImpl = generateSpec
}) {
  if (!userStory || !String(userStory).trim()) throw new Error('La historia de usuario está vacía.');

  const { contract, trace: contractTrace } = await generateContractImpl(cfg, {
    userStory, backStack: back?.stack, frontStack: front?.stack, language, backContext
  });

  const backSpec = await generateSpecImpl(cfg, {
    language, mode, documentText: roleDocument('BACKEND', back?.stack, contract, userStory),
    templates: back?.templates || {}, constitution: back?.constitution || ''
  });

  const frontSpec = await generateSpecImpl(cfg, {
    language, mode, documentText: roleDocument('FRONTEND', front?.stack, contract, userStory),
    templates: front?.templates || {}, constitution: front?.constitution || ''
  });

  return { contract, contractTrace, back: backSpec, front: frontSpec };
}
