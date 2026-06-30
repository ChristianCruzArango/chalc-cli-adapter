// lib/contract.mjs — genera el CONTRATO de la feature (la API que el back expone y el front consume).
// Responsabilidad única: HU + stacks → documento Markdown del contrato. El back lidera (es dueño de la API).
// Reusa el cliente de IA y el cerco estricto: la IA estructura, no inventa (lo desconocido → [NEEDS CLARIFICATION]).

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat } from './ai.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = join(HERE, 'prompts', 'feature-contract.prompt.xml');

// Inyecta ${VAR} validando que todas estén resueltas (estándar de prompts HALLC).
function inject(template, vars) {
  return template.replace(/\$\{(\w+)\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`Falta variable de prompt: ${k}`);
    return vars[k];
  });
}

// Quita un posible cercado ``` que el modelo a veces pone alrededor de todo el documento.
function unfence(text) {
  const t = String(text || '').trim();
  return t.startsWith('```') ? t.replace(/^```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim() : t;
}

// Genera el contrato. Devuelve { contract, trace }. chatImpl es inyectable para testear sin tokens.
export async function generateContract(cfg, { userStory, backStack, frontStack, language = 'español', backContext = '', chatImpl = chat }) {
  const tpl = await readFile(PROMPT_FILE, 'utf8');
  const system = inject(tpl, {
    LANGUAGE: language,
    BACK_STACK: backStack || '(no detectado)',
    FRONT_STACK: frontStack || '(no detectado)',
    BACK_CONTEXT: (backContext || '(sin contexto del back)').trim(),
    USER_STORY: String(userStory || '').trim()
  });
  const raw = await chatImpl(cfg, { system, user: 'Genera el contrato.', maxTokens: 8000 });
  const contract = unfence(raw);
  if (!contract) throw new Error('La IA no devolvió el contrato.');
  return { contract, trace: { system, raw } };
}
