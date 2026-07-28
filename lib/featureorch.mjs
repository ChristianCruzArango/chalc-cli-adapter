// lib/featureorch.mjs — orquestador neutral del flujo full-stack. Responsabilidad única: coordinar a los
// "agentes" (back, front y opcionalmente móvil) alrededor de UN contrato compartido. El back lidera el
// contrato; front y móvil lo consumen. Cada lado se especifica con el harness estricto de spec-gen (reúso),
// aterrizado en SU rol y stack. No decide por ningún lado: solo reparte, comparte el contrato y junta.

import { generateContract } from './contract.mjs';
import { generateSpec } from './specgen.mjs';

// Qué incluye cada rol en SU spec. Front y móvil son consumidores: nunca reimplementan lógica del back.
const ROLE_SCOPE = {
  BACKEND: 'Incluye solo lo del backend: endpoints, modelo de datos, reglas de negocio, validación y persistencia.',
  FRONTEND: 'Incluye solo lo del frontend: pantallas, estado, navegación, validación de formularios y CONSUMO del contrato (no reimplementes la lógica del backend).',
  MOBILE: 'Incluye solo lo de la app móvil: pantallas, navegación, estado, manejo de conectividad/offline y CONSUMO del contrato (no reimplementes la lógica del backend).'
};
const ROLE_LABEL = { BACKEND: 'BACKEND', FRONTEND: 'FRONTEND', MOBILE: 'MÓVIL (app móvil)' };

// Documento fuente aumentado para un lado: rol + contrato autoritativo + HU. Se pasa a generateSpec como
// documentText; el harness de spec-gen lo trata como fuente. Mantiene R# compartidos para trazabilidad cruzada.
function roleDocument(side, stack, contract, userStory) {
  return [
    `<role>${side}</role>`,
    `Estás especificando ÚNICAMENTE la parte ${ROLE_LABEL[side]} de esta feature, para un stack ${stack || '(no detectado)'}.`,
    'Las otras partes se especifican por separado. El CONTRATO de API de abajo es AUTORITATIVO: respétalo, no lo redefinas.',
    'Reutiliza los MISMOS identificadores de requisito (R1, R2, …) del contrato para conservar la trazabilidad cruzada.',
    ROLE_SCOPE[side],
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

// Orquesta el flujo: 1) contrato (back lidera) → 2) spec del back → 3) spec del front → 4) spec del móvil
// (solo si hay). `back`/`front`/`mobile` = { stack, templates, constitution }; `mobile` es OPCIONAL.
// Impls inyectables para testear sin tokens.
// Devuelve { contract, contractTrace, back: <generateSpec>, front: <generateSpec>, mobile: <generateSpec>|null }.
export async function orchestrateFeature({
  cfg, userStory, language = 'español', mode = 'lite', back, front, mobile = null, backContext = '',
  generateContractImpl = generateContract, generateSpecImpl = generateSpec
}) {
  if (!userStory || !String(userStory).trim()) throw new Error('La historia de usuario está vacía.');

  const { contract, trace: contractTrace } = await generateContractImpl(cfg, {
    userStory, backStack: back?.stack, frontStack: front?.stack,
    ...(mobile ? { mobileStack: mobile.stack } : {}), language, backContext
  });

  // Un lado se especifica siempre igual: su rol + el contrato compartido, con SUS plantillas/constitución.
  const specForSide = (role, side) => generateSpecImpl(cfg, {
    language, mode, documentText: roleDocument(role, side?.stack, contract, userStory),
    templates: side?.templates || {}, constitution: side?.constitution || ''
  });

  const backSpec = await specForSide('BACKEND', back);
  const frontSpec = await specForSide('FRONTEND', front);
  const mobileSpec = mobile ? await specForSide('MOBILE', mobile) : null;

  return { contract, contractTrace, back: backSpec, front: frontSpec, mobile: mobileSpec };
}
