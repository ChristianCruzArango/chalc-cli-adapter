// cli/engine/protocol.mjs — protocolo del turno del agente para modelos locales.
// El modelo responde SIEMPRE un único JSON compacto. Aquí se parsea de forma robusta y se valida.
// Diseñado para modelos limitados (qwen2.5-coder, deepseek-coder): tolerante al cercado ``` y a texto
// alrededor del JSON, y con un mensaje de reintento accionable cuando la respuesta no cumple el contrato.
//
// Turnos válidos:
//   { "thought": "...", "action": { "tool": "read", "args": { "path": "src/x.js" } } }
//   { "done": true, "summary": "..." }

import { unfence } from '../../lib/promptkit.mjs';

// Escanea el PRIMER objeto JSON balanceado del texto, ignorando llaves dentro de strings. Más robusto
// que "del primer { al último }": prosa alrededor con llaves ("uso {write}…") ya no invalida un objeto
// correcto que venga después — cada candidato que no parsea se descarta y se sigue con el siguiente '{'.
function extractJsonObject(text) {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }   // candidato inválido: probar el siguiente '{'
        }
      }
    }
  }
  return undefined;
}

// Extrae el objeto JSON de una respuesta cruda. Robusto: quita ``` y escanea llaves balanceadas.
// Devuelve { ok:true, value } o { ok:false, error } — nunca lanza.
export function parseTurn(raw) {
  const text = unfence(raw);
  const value = extractJsonObject(text);
  if (value === undefined) return { ok: false, error: 'The reply does not contain valid JSON.' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'The reply must be a single JSON object.' };
  }
  return { ok: true, value };
}

// Valida la forma del turno ya parseado. Devuelve { ok:true, turn } normalizado, o { ok:false, error }.
// turn.kind es 'done' | 'action' para que el loop no vuelva a inspeccionar la forma.
export function validateTurn(value) {
  if (value.done === true) {
    return { ok: true, turn: { kind: 'done', summary: String(value.summary || '').trim() } };
  }
  const action = value.action;
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return { ok: false, error: 'Missing "action" (or use {"done":true,"summary":"..."} to finish).' };
  }
  const tool = typeof action.tool === 'string' ? action.tool.trim() : '';
  if (!tool) {
    return { ok: false, error: 'action.tool must be the (string) name of a tool.' };
  }
  const args = action.args && typeof action.args === 'object' && !Array.isArray(action.args) ? action.args : {};
  return { ok: true, turn: { kind: 'action', tool, args, thought: String(value.thought || '').trim() } };
}

// Parsea Y valida en un paso. Atajo para el loop.
export function readTurn(raw) {
  const parsed = parseTurn(raw);
  if (!parsed.ok) return parsed;
  return validateTurn(parsed.value);
}

// Mensaje de corrección para el reintento: recuerda el contrato SIN volcar la respuesta entera
// (gastaría contexto del modelo chico). Se antepone el error concreto para que sepa qué arreglar.
export function retryMessage(error) {
  return [
    `Your last reply was not valid: ${error}`,
    'Reply EXCLUSIVELY with a single JSON object, no text and no ``` around it.',
    'To act:    {"thought":"brief","action":{"tool":"<name>","args":{...}}}',
    'To finish: {"done":true,"summary":"what you did"}'
  ].join('\n');
}
