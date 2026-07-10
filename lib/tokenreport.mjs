// lib/tokenreport.mjs — agregado del histórico de consumo IA (specs/002-chalc-tokens, R4).
// Responsabilidad única: convertir los eventos de .chalc/tokens.jsonl en el resumen que consume
// `chalc tokens` (humano y --json). Función pura: sin I/O, testeable sin disco.

import { estimateCostUSD } from './pricing.mjs';

// Suma un evento en el grupo. usd null = "algún modelo del grupo no tiene precio": en cuanto un
// evento no se puede costear, el grupo entero deja de dar cifra — jamás un total a medias (R6).
function addTo(group, event, usd) {
  group.input += event.input || 0;
  group.output += event.output || 0;
  group.calls += event.calls || 1;
  if (usd === null) group.usd = null;
  else if (group.usd !== null) group.usd = Math.round((group.usd + usd) * 1e6) / 1e6;   // sin ruido flotante
  return group;
}

const newGroup = () => ({ input: 0, output: 0, calls: 0, usd: 0 });

// events: los de readTokenLog. userPrices: cfg.prices del usuario (pisa la tabla local, R7).
// Devuelve { total, byCommand, byTask, byModel (con `priced`), unpriced } — el contrato de --json (R9).
export function aggregateTokenLog(events = [], userPrices = {}) {
  const total = newGroup();
  const byCommand = {};
  const byTask = {};
  const byModel = {};
  const unpriced = [];
  for (const e of events) {
    const usd = estimateCostUSD(e, userPrices);
    const model = String(e.model || '(desconocido)');
    addTo(total, e, usd);
    addTo(byCommand[e.command || '(sin comando)'] ??= newGroup(), e, usd);
    addTo(byTask[e.task || 'default'] ??= newGroup(), e, usd);
    addTo(byModel[model] ??= { ...newGroup(), priced: true }, e, usd);
    if (usd === null) {
      byModel[model].priced = false;
      if (!unpriced.includes(model)) unpriced.push(model);
    }
  }
  return { total, byCommand, byTask, byModel, unpriced };
}
