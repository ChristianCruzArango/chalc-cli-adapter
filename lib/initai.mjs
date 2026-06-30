// lib/initai.mjs — capa OPT-IN con IA para sugerir arquitectura en `chalc init`.
// Trocea la propuesta (Word/PDF/texto) en secciones, las comprime con CCR (reversible) y deja que el modelo
// haga `recall` solo de lo que necesita → ahorra tokens en docs grandes. Usa el modelo barato (perfil 'qa').
// Determinista de borde: NUNCA acepta una arquitectura que no esté en el stack (si la inventa, cae al fallback).

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat, configForTask } from './ai.mjs';
import { createCcrStore } from './ccr.mjs';
import { parseAgentMessage } from './qaagent.mjs';
import { archText, getStack, suggestArchitectures, analyzeProjectProposal } from './init.mjs';
import { inject } from './promptkit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = join(HERE, 'prompts', 'init-architect.prompt.xml');

// Sanea las clarifications del modelo: una sola pregunta por ítem (descarta el razonamiento que el modelo
// a veces pega tras el "?"), sin vacíos ni duplicados, máximo 2. El prompt ya las acota; esto es el cinturón.
export function sanitizeClarifications(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => String(c).trim())
    .map((c) => { const i = c.indexOf('?'); return i >= 0 ? c.slice(0, i + 1).trim() : c; })
    .filter(Boolean)
    .filter((c, i, a) => a.indexOf(c) === i)
    .slice(0, 2);
}

// Trocea la propuesta en secciones (por líneas en blanco o encabezados markdown). Una sección por bloque.
export function chunkProposal(text) {
  const blocks = String(text || '')
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.length ? blocks : [String(text || '').trim()].filter(Boolean);
}

function renderArchitectures(stackId) {
  return getStack(stackId).architectures
    .map((a) => `- ${a.id}: ${archText(a.label)} — ${archText(a.fit)} (tradeoff: ${archText(a.tradeoff)})`)
    .join('\n');
}

async function loadArchitectPrompt({ stackId, principles, sections, language }) {
  const tpl = await readFile(PROMPT_FILE, 'utf8');
  return inject(tpl, {
    LANGUAGE: language || 'español',
    STACK: getStack(stackId).label,
    ARCHITECTURES: renderArchitectures(stackId),
    PRINCIPLES: (principles || []).join(', '),
    SECTIONS: sections.trim() || '(propuesta vacía)'
  });
}

// Recomienda una arquitectura del stack con IA. chatImpl/ccr inyectables para testear sin tokens.
// Devuelve { architectureId, reasoning, clarifications, ccr, source }. source: 'ai' | 'fallback'.
export async function analyzeArchitectureWithAi(opts) {
  const {
    cfg, stackId, proposal, principles = [], language,
    chatImpl = chat, maxSteps = 5, maxTokens = 1200, ccr
  } = opts;
  const stack = getStack(stackId);
  if (!stack) throw new Error(`Stack desconocido: ${stackId}`);
  const validIds = new Set(stack.architectures.map((a) => a.id));
  const taskCfg = configForTask(cfg, 'qa');   // arquitectura = tarea de clasificación → modelo económico
  const store = ccr === false ? null : (ccr && typeof ccr.compact === 'function' ? ccr : createCcrStore({ threshold: 400, previewChars: 200 }));

  // Compacta cada sección: pequeñas quedan completas; grandes pasan a [CCR ref=...]. Guardamos la ref para recall.
  const sections = chunkProposal(proposal).map((full) => {
    const rendered = store ? store.compact(full, { type: 'section' }) : full;
    const ref = rendered.startsWith('[CCR ') ? (rendered.match(/ref=(\w+)/) || [])[1] : null;
    return { full, rendered, ref };
  });
  const recalled = new Set();
  const deterministicId = suggestArchitectures(stackId, analyzeProjectProposal(proposal)).find((s) => s.recommended)?.id || stack.architectures[0].id;
  const finish = (id, extra) => ({ architectureId: validIds.has(id) ? id : deterministicId, ...extra, ccr: store?.stats() || null });

  for (let step = 1; step <= maxSteps; step++) {
    const body = sections.map((s) => (s.ref && !recalled.has(s.ref)) ? s.rendered : s.full).join('\n\n');
    const system = await loadArchitectPrompt({ stackId, principles, sections: body, language });
    const raw = await chatImpl(taskCfg, { system, user: 'Recomienda la arquitectura.', json: true, maxTokens });

    let msg;
    try { msg = parseAgentMessage(raw); }
    catch { return finish(deterministicId, { reasoning: '', clarifications: [], source: 'fallback', error: 'JSON inválido del modelo' }); }

    if (msg.recall && store) {
      if (sections.some((s) => s.ref === msg.recall)) recalled.add(msg.recall);
      continue;
    }
    if (msg.done) {
      const valid = validIds.has(msg.architectureId);
      return finish(msg.architectureId, {
        reasoning: String(msg.reasoning || '').trim(),
        clarifications: sanitizeClarifications(msg.clarifications),
        source: 'ai',
        ...(valid ? {} : { invalidId: msg.architectureId })   // inventó una → caímos al fallback
      });
    }
  }
  return finish(deterministicId, { reasoning: '', clarifications: [], source: 'fallback', error: `sin recomendación en ${maxSteps} pasos` });
}
