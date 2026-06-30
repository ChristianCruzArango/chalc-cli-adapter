// lib/ai.mjs — cliente multi-proveedor (fetch nativo, sin dependencias) + config en ~/.chalc/config.json.
// Es la ÚNICA parte de Chalc que llama a una IA, y es opt-in: la key la pone el usuario.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fetchWithTimeout, readLimitedText } from './net.mjs';
import { recordUsage } from './tokenmeter.mjs';
import { restrictToOwner } from './securefile.mjs';

const CONFIG_DIR = join(homedir(), '.chalc');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const AI_TIMEOUT_MS = 120000;

// kind: cómo se habla con la API. 'anthropic' nativo, 'azure' (endpoint+deployment), 'openai' (compatible).
export const PROVIDERS = {
  openrouter: { label: 'OpenRouter (1 key → muchos modelos)', kind: 'openai', baseURL: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-sonnet-4.6', needsKey: true },
  anthropic:  { label: 'Anthropic (Claude)', kind: 'anthropic', baseURL: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-6', needsKey: true },
  openai:     { label: 'OpenAI', kind: 'openai', baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', needsKey: true },
  google:     { label: 'Google Gemini', kind: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash', needsKey: true },
  ollama:     { label: 'Ollama (local, sin key)', kind: 'openai', baseURL: 'http://localhost:11434/v1', defaultModel: 'llama3.1', needsKey: false }
};

export const TASK_MODEL_ENV = {
  spec: 'CHALC_SPEC_MODEL',
  qa: 'CHALC_QA_MODEL',
  repair: 'CHALC_REPAIR_MODEL'
};

export async function loadConfig() {
  let cfg = {};
  if (existsSync(CONFIG_PATH)) {
    try { cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf8')); } catch { /* config corrupta: se ignora */ }
  }
  // overrides por entorno
  if (process.env.CHALC_PROVIDER) cfg.provider = process.env.CHALC_PROVIDER;
  if (process.env.CHALC_API_KEY) cfg.apiKey = process.env.CHALC_API_KEY;
  if (process.env.CHALC_MODEL) cfg.model = process.env.CHALC_MODEL;
  for (const [task, envName] of Object.entries(TASK_MODEL_ENV)) {
    if (process.env[envName]) cfg.models = { ...(cfg.models || {}), [task]: process.env[envName] };
  }
  if (process.env.CHALC_BASE_URL) cfg.baseURL = process.env.CHALC_BASE_URL;
  if (process.env.CHALC_AI_PROFILE) cfg.profile = process.env.CHALC_AI_PROFILE;
  return cfg;
}

export async function saveConfig(cfg) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  restrictToOwner(CONFIG_PATH);   // solo el dueño: chmod 0600 en POSIX, ACL vía icacls en Windows
  return CONFIG_PATH;
}

export function isConfigured(cfg) {
  if (!cfg || !cfg.provider) return false;
  const prov = PROVIDERS[cfg.provider];
  if (!prov) return false;
  if (prov.needsKey && !cfg.apiKey) return false;
  if (prov.needsBaseURL && !cfg.baseURL) return false;
  return true;
}

export function modelForTask(cfg, task = 'default') {
  const prov = PROVIDERS[cfg?.provider];
  return cfg?.models?.[task] || cfg?.model || prov?.defaultModel || '';
}

export function configForTask(cfg, task = 'default') {
  return { ...(cfg || {}), model: modelForTask(cfg, task) };
}

// Aplica los modelos por tarea de un perfil sobre la config, sin pisar lo que el usuario ya fijó.
// Providers locales (Ollama, LM Studio…): el modelo lo elige el usuario entre los que tiene instalados,
// así que el perfil NO impone un nombre fijo (p. ej. llama3.1) que quizá no exista y reventaría al llamar.
export function applyProfileModels(cfg, profile) {
  if (!profile?.models || !cfg?.provider) return cfg;
  const prov = PROVIDERS[cfg.provider];
  if (prov && !prov.needsKey) return { ...cfg, profile: profile.id };
  const models = { ...(cfg.models || {}) };
  for (const task of ['spec', 'qa', 'repair']) {
    if (!models[task] && profile.models?.[task]?.[cfg.provider]) models[task] = profile.models[task][cfg.provider];
  }
  return { ...cfg, profile: profile.id, models };
}

// Lista los modelos disponibles en el endpoint (OpenAI-compatible: Ollama, LM Studio, vLLM…).
// Best-effort: devuelve [] si el servidor no responde o no soporta /models. Nunca lanza.
// Sirve para que la config ofrezca los modelos REALES instalados en vez de un default que no existe.
export async function listModels(cfg) {
  const prov = PROVIDERS[cfg?.provider];
  const baseURL = (cfg?.baseURL || prov?.baseURL || '').replace(/\/$/, '');
  if (!baseURL) return [];
  try {
    const res = await fetchWithTimeout(`${baseURL}/models`, {
      timeoutMs: 5000,
      headers: cfg?.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}
    });
    if (!res.ok) return [];
    const j = await res.json();
    const ids = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

// Llama al modelo. Devuelve el texto de la respuesta. Lanza Error con detalle si la API falla.
// json=true fuerza salida JSON (response_format en OpenAI-compatible; prefill en Anthropic).
export async function chat(cfg, { system, user, maxTokens = 8192, json = false }) {
  const prov = PROVIDERS[cfg.provider];
  if (!prov) throw new Error(`Proveedor desconocido: ${cfg.provider}`);
  const model = cfg.model || prov.defaultModel;
  const baseURL = (cfg.baseURL || prov.baseURL).replace(/\/$/, '');

  if (prov.kind === 'anthropic') {
    const messages = [{ role: 'user', content: user }];
    if (json) messages.push({ role: 'assistant', content: '{' });   // prefill: obliga a arrancar el JSON
    const res = await fetchWithTimeout(`${baseURL}/messages`, {
      method: 'POST',
      timeoutMs: AI_TIMEOUT_MS,
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await readLimitedText(res)}`);
    const j = await res.json();
    recordUsage(j.usage);
    let text = (j.content || []).map((b) => b.text || '').join('');
    if (json && !text.trimStart().startsWith('{')) text = '{' + text;   // re-pone el '{' del prefill
    return text;
  }

  // OpenAI-compatible: openrouter, openai, google, ollama
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetchWithTimeout(`${baseURL}/chat/completions`, {
    method: 'POST',
    timeoutMs: AI_TIMEOUT_MS,
    headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await readLimitedText(res)}`);
  const j = await res.json();
  recordUsage(j.usage);
  return j.choices?.[0]?.message?.content || '';
}
