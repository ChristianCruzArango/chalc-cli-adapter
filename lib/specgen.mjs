// lib/specgen.mjs — convierte un documento en archivos SDD (spec/plan/tasks) usando la IA configurada.
// El prompt vive en prompts/spec-gen.prompt.xml (formato XML según el estándar HALLC).

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat } from './ai.mjs';
import { validateGeneratedSpec } from './specvalidate.mjs';
import { inject, parseSections } from './promptkit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = join(HERE, 'prompts', 'spec-gen.prompt.xml');

// Parsea la respuesta por marcas ===FEATURE===/===SPEC===/===PLAN===/===TASKS===.
// El parser genérico vive en promptkit (lo comparte con el turno de `chalc debate`); aquí solo se
// nombran las secciones de una spec y se colocan en los archivos que les tocan.
export function parseDelimited(raw) {
  const s = parseSections(raw, ['FEATURE', 'SPEC', 'PLAN', 'TASKS']);
  return {
    feature: s.FEATURE,
    files: { 'spec.md': s.SPEC, 'plan.md': s.PLAN, 'tasks.md': s.TASKS }
  };
}

export async function buildPrompt({ language, mode, documentText, templates, constitution }) {
  const tpl = await readFile(PROMPT_FILE, 'utf8');
  const system = inject(tpl, {
    LANGUAGE: language || 'español',   // nombre del idioma de salida (ej. "español", "English")
    MODE: mode || 'lite',
    CONSTITUTION: (constitution || '(sin constitución provista)').trim(),
    SPEC_TEMPLATE: (templates?.spec || '').trim(),
    PLAN_TEMPLATE: (templates?.plan || '').trim(),
    TASKS_TEMPLATE: (templates?.tasks || '').trim()
  });
  const user = `<source_document>\n${documentText}\n</source_document>`;
  return { system, user };
}

// Llama a la IA y devuelve { feature, files: { 'spec.md', 'plan.md', 'tasks.md' } }.
export async function generateSpec(cfg, opts) {
  const { system, user } = await buildPrompt(opts);
  const raw = await chat(cfg, { system, user, maxTokens: 16000 });
  const parsed = parseDelimited(raw);
  if (!parsed.files['spec.md']) {
    const snippet = (raw || '').replace(/\s+/g, ' ').slice(0, 240);
    throw new Error(`La IA no devolvió el spec esperado. Respuesta (inicio): ${snippet || '(vacía)'}`);
  }
  parsed.validation = validateGeneratedSpec(parsed.files);
  parsed.trace = { system, user, raw };
  return parsed;
}
