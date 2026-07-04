// cli/engine/model.mjs — adaptador de modelo para el loop: envuelve la IA en la firma que espera runAgent,
// chatImpl({system,user}) -> texto crudo. Para Ollama usa la ruta NATIVA /api/chat con options.num_ctx
// (la ruta OpenAI-compatible IGNORA num_ctx y dejaría la ventana en el default 2048, fatal para el harness)
// y format:'json' para reforzar el contrato del protocolo en modelos locales. Cloud → reutiliza chat().
// EXCEPCIÓN: modelos razonadores (capability "thinking", p. ej. gpt-oss) — con format:'json' Ollama
// devuelve content VACÍO (la gramática JSON choca con su plantilla de razonamiento), así que para ellos
// se omite format (el protocolo ya extrae el JSON del texto) y se da margen extra al num_predict porque
// el razonamiento consume tokens de salida ANTES de la respuesta.

import { chat } from '../../lib/ai.mjs';
import { fetchWithTimeout, readLimitedText } from '../../lib/net.mjs';
import { recordUsage } from '../../lib/tokenmeter.mjs';

// Timeout de inferencia local: en CPU un modelo 14-20B con prompt largo + razonamiento toma MINUTOS
// legítimamente (no es un cuelgue). Configurable con cli.timeoutMs para hardware más lento/rápido.
const AI_TIMEOUT_MS = 300000;
const OLLAMA_DEFAULT_CTX = 16384;   // sube la ventana del default 2048 de Ollama; cabe el harness + varios pasos
const THINKING_HEADROOM = 2048;     // tokens extra de num_predict para el razonamiento de los modelos que piensan

// ¿La config apunta a un Ollama local? provider explícito o baseURL al puerto 11434.
export function isOllama(cfg) {
  return cfg?.provider === 'ollama' || /:11434(\/|$)/.test(cfg?.baseURL || '');
}

// ¿El modelo declara la capability "thinking"? (/api/show, cacheado por proceso: una sonda por modelo).
// Sin señal (endpoint ausente, error) se asume clásico → conserva format:'json' como siempre.
const capsCache = new Map();
async function modelThinks(baseURL, model, fetchImpl) {
  const key = `${baseURL}|${model}`;
  if (!capsCache.has(key)) {
    let thinks = false;
    try {
      const res = await fetchImpl(`${baseURL}/api/show`, {
        method: 'POST',
        timeoutMs: 10000,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model })
      });
      if (res.ok) thinks = ((await res.json()).capabilities || []).includes('thinking');
    } catch { /* sin señal → clásico */ }
    capsCache.set(key, thinks);
  }
  return capsCache.get(key);
}

// Llamada nativa a Ollama. Fija num_ctx (imposible por la ruta OpenAI-compatible) y pide salida JSON.
// fetchImpl es inyectable para testear sin red.
export async function chatOllama(cfg, { system, user, numCtx = OLLAMA_DEFAULT_CTX, maxTokens = 2048, fetchImpl = fetchWithTimeout }) {
  const baseURL = (cfg.baseURL || 'http://localhost:11434').replace(/\/v1\/?$/, '').replace(/\/$/, '');
  const thinks = await modelThinks(baseURL, cfg.model, fetchImpl);
  const body = {
    model: cfg.model,
    stream: false,
    ...(thinks ? {} : { format: 'json' }),
    // gpt-oss soporta niveles de razonamiento; "low" recorta minutos por turno en CPU sin perder el
    // contrato (los pasos del agente son cortos). Solo para esa familia: otros razonadores no aceptan niveles.
    ...(thinks && /^gpt-oss/.test(cfg.model || '') ? { think: cfg?.cli?.think || 'low' } : {}),
    options: { num_ctx: numCtx, num_predict: thinks ? maxTokens + THINKING_HEADROOM : maxTokens },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  };
  const res = await fetchImpl(`${baseURL}/api/chat`, {
    method: 'POST',
    timeoutMs: cfg?.cli?.timeoutMs || AI_TIMEOUT_MS,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await readLimitedText(res)}`);
  const j = await res.json();
  // Ollama nativo reporta el consumo como prompt_eval_count/eval_count; se normaliza al medidor común.
  if (j.prompt_eval_count != null || j.eval_count != null) {
    recordUsage({ prompt_tokens: j.prompt_eval_count || 0, completion_tokens: j.eval_count || 0 });
  }
  const msg = j.message || {};
  if (msg.content && msg.content.trim()) return msg.content;
  // Razonadores con tool-calling nativo (gpt-oss): ignoran "reply with JSON" y emiten un tool call
  // harmony, que Ollama parsea a message.tool_calls AUNQUE no se declaren tools. Se traduce al
  // protocolo (UN action por turno); nombres/args inválidos los corrige el feedback del loop.
  const fn = msg.tool_calls?.[0]?.function;
  if (fn?.name) {
    let args = fn.arguments ?? {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    return JSON.stringify({ thought: String(msg.thinking || '').slice(0, 300), action: { tool: fn.name, args } });
  }
  // Última red: a veces el JSON queda literal dentro del thinking; el protocolo intenta extraerlo.
  return msg.thinking || '';
}

// Construye el chatImpl que consume el loop, según cfg. Ollama → ruta nativa con num_ctx; resto → chat() con
// json:true (fuerza el contrato JSON). maxTokens acotado: el protocolo pide UN objeto JSON por turno, no prosa.
export function createChatImpl(cfg, { numCtx, maxTokens = 2048 } = {}) {
  if (isOllama(cfg)) {
    return ({ system, user }) => chatOllama(cfg, { system, user, numCtx, maxTokens });
  }
  return ({ system, user }) => chat(cfg, { system, user, maxTokens, json: true });
}
