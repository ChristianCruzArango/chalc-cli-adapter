// lib/featureorch.mjs — orquestador neutral del flujo full-stack. Responsabilidad única: coordinar a los
// "agentes" (back, front y opcionalmente móvil) alrededor de UN contrato compartido. El back lidera el
// contrato; front y móvil lo consumen. Cada lado se especifica con el harness estricto de spec-gen (reúso),
// aterrizado en SU rol y stack. No decide por ningún lado: solo reparte, comparte el contrato y junta.

import { generateContract } from './contract.mjs';
import { generateSpec } from './specgen.mjs';
import { t } from './i18n.mjs';
import { escapeClosingTags } from './untrusted.mjs';

// Qué incluye cada rol en SU spec. Front y móvil son consumidores: nunca reimplementan lógica del back.
// Las órdenes al modelo van en inglés, el idioma de los prompts; el idioma de salida lo fija ${LANGUAGE} (C3).
const ROLE_SCOPE = {
  BACKEND: 'Include only the backend: endpoints, data model, business rules, validation and persistence.',
  FRONTEND: 'Include only the frontend: screens, state, navigation, form validation and CONSUMPTION of the contract (do not reimplement backend logic).',
  MOBILE: 'Include only the mobile app: screens, navigation, state, connectivity/offline handling and CONSUMPTION of the contract (do not reimplement backend logic).'
};
const ROLE_LABEL = { BACKEND: 'BACKEND', FRONTEND: 'FRONTEND', MOBILE: 'MOBILE (mobile app)' };

// Documento fuente aumentado para un lado: rol + contrato autoritativo + HU. Se pasa a generateSpec como
// documentText; el harness de spec-gen lo trata como fuente. Mantiene R# compartidos para trazabilidad cruzada.
// Contrato (salida de un modelo) e HU (texto del usuario) van escapados: no pueden cerrar su bloque (S4).
function roleDocument(side, stack, contract, userStory) {
  return [
    `<role>${side}</role>`,
    `You are specifying ONLY the ${ROLE_LABEL[side]} part of this feature, for a ${stack || '(not detected)'} stack.`,
    'The other parts are specified separately. The API CONTRACT below is AUTHORITATIVE: respect it, do not redefine it.',
    'Reuse the SAME requirement ids (R1, R2, …) from the contract to keep cross-repo traceability.',
    ROLE_SCOPE[side],
    '',
    '<api_contract>',
    escapeClosingTags(contract),
    '</api_contract>',
    '',
    '<user_story>',
    escapeClosingTags(String(userStory).trim()),   // orchestrateFeature ya rechazó la HU vacía
    '</user_story>'
  ].join('\n');
}

// Orquesta el flujo: 1) contrato (back lidera) → 2) spec del back → 3) spec del front → 4) spec del móvil
// (solo si hay). `back`/`front`/`mobile` = { stack, templates, constitution }; `mobile` es OPCIONAL.
// Impls inyectables para testear sin tokens.
// `onSpec(role, spec, contract)` (opcional) recibe cada spec EN CUANTO termina, para escribirla ya: si
// un lado posterior falla (p. ej. un 429), lo pagado no se pierde. El error lleva además `partial` (F6).
// Devuelve { contract, contractTrace, back: <generateSpec>, front: <generateSpec>, mobile: <generateSpec>|null }.
export async function orchestrateFeature({
  cfg, userStory, language = 'español', mode = 'lite', back, front, mobile = null, backContext = '',
  generateContractImpl = generateContract, generateSpecImpl = generateSpec, onSpec = () => {}
}) {
  if (!userStory || !String(userStory).trim()) throw new Error(t('featEmptyStory'));

  const { contract, trace: contractTrace } = await generateContractImpl(cfg, {
    userStory, backStack: back?.stack, frontStack: front?.stack,
    ...(mobile ? { mobileStack: mobile.stack } : {}), language, backContext
  });

  // Un lado se especifica siempre igual: su rol + el contrato compartido, con SUS plantillas/constitución.
  const specForSide = async (role, side) => {
    const spec = await generateSpecImpl(cfg, {
      language, mode, documentText: roleDocument(role, side?.stack, contract, userStory),
      templates: side?.templates || {}, constitution: side?.constitution || '', concepts: side?.concepts || []
    });
    await onSpec(role, spec, contract);
    return spec;
  };

  const result = { contract, contractTrace, back: null, front: null, mobile: null };
  try {
    result.back = await specForSide('BACKEND', back);
    result.front = await specForSide('FRONTEND', front);
    if (mobile) result.mobile = await specForSide('MOBILE', mobile);
  } catch (e) {
    e.partial = result;
    throw e;
  }
  return result;
}

// Multi-HU (spec 005, R7): orquesta N HUs EN SECUENCIA, alimentando al contrato de la HU N los
// contratos de las 1..N-1 (vía backContext, que el prompt del contrato ya inyecta) para que no
// redefina rutas ni shapes ya declarados en la misma corrida. Devuelve una lista, un resultado
// de orchestrateFeature por HU más su userStory.
export async function orchestrateFeatures({ userStories = [], backContext = '', ...rest }) {
  if (!userStories.length) throw new Error(t('featNoStories'));
  const results = [];
  const priors = [];   // contratos ya generados en esta corrida
  for (const userStory of userStories) {
    const context = priors.length
      ? [backContext, '',
         'CONTRACTS ALREADY DEFINED IN THIS RUN — they are ONLY a reference of routes already taken:',
         'Do NOT copy their endpoints or shapes into the new contract; do NOT redefine their routes.',
         'The new contract covers ONLY the user story below.', '', ...priors].join('\n').trim()
      : backContext;
    let result;
    try { result = await orchestrateFeature({ ...rest, userStory, backContext: context }); }
    catch (e) { e.partialStories = results; throw e; }   // F6: las HUs terminadas no se pierden
    priors.push(result.contract);
    results.push({ userStory, ...result });
  }
  return results;
}
