// metrics.mjs — medir al equipo con su propio registro (spec 037). Responsabilidad ÚNICA: contar, por nivel de
// modelo y versión de instrucciones, cómo salieron las entregas y los veredictos. Razón de cambio: qué se mide.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO y gratis: no llama a ningún modelo. Sirve para ver si cambiar las instrucciones de un rol, o el nivel de
// quien desarrolla, cambió algo. Son conteos: con pocas entregas no distinguen una mejora de la suerte.

const UNKNOWN = '?';
const sortBy = (...keys) => (a, b) => keys.map((key) => String(a[key]).localeCompare(String(b[key]))).find((order) => order !== 0) || 0;

// Un contador por clave, creado la primera vez que se pide.
function counters(make) {
  const all = new Map();
  return { of: (key, seed) => { if (!all.has(key)) all.set(key, make(seed)); return all.get(key); }, list: () => [...all.values()] };
}

// Cierra la entrega en curso de una spec: aprobada si firmó alguien y todos en OK; rechazada si alguno no.
function settle(spec) {
  const delivery = spec.delivery;
  spec.delivery = null;
  if (!delivery || !delivery.verdicts.length) return;
  const approved = delivery.verdicts.every(Boolean);
  delivery.row[approved ? 'approved' : 'rejected'] += 1;
  if (approved && delivery.first) delivery.row.firstPass += 1;
}

// Qué hace cada evento con las cuentas. `m` son los contadores; `s`, lo que se sabe de la spec.
const ON = {
  started: (m, s, e) => { s.tier = e.tier; s.startedAt = Date.parse(e.at); },
  dispatched: (m, s, e) => {
    if (e.role === 'desarrollador') s.config = { tier: e.tier, instructions: e.instructions || UNKNOWN };
    else s.versions.set(e.role, e.instructions || UNKNOWN);
  },
  delivered: (m, s) => { settle(s); s.delivery = { row: m.developer(s), verdicts: [], first: s.deliveries === 0 }; s.deliveries += 1; s.delivery.row.deliveries += 1; },
  reviewed: (m, s, e) => {
    // La integración no es un rol que revise la entrega: mide la unión.
    if (e.role === 'integracion') { m.integration.broke += 1; return; }
    const row = m.reviewers.of(`${e.role}\n${s.versions.get(e.role) || UNKNOWN}`, { role: e.role, instructions: s.versions.get(e.role) || UNKNOWN });
    row.verdicts += 1;
    if (!e.ok) row.rejections += 1;
    s.delivery?.verdicts.push(Boolean(e.ok));
  },
  relaunched: (m, s, e) => { settle(s); m.developer(s).relaunched += 1; s.tier = e.tier; s.config = null; },
  escalated: (m, s) => { settle(s); m.developer(s).escalated += 1; },
  blocked: (m, s, e) => { if (e.by === 'integracion') m.integration.conflicts += 1; },
  integrated: (m, s, e) => { m.integration.merged += 1; if (s.startedAt) m.leadTimes.push(Date.parse(e.at) - s.startedAt); }
};

// Las specs que cuentan: todas, o las de `feature`.
function specsOf(events, feature) {
  const added = events.filter((e) => e.type === 'spec_added' && (!feature || e.feature === feature));
  return new Map(added.map((e) => [e.spec, { tier: UNKNOWN, config: null, versions: new Map(), delivery: null, deliveries: 0, startedAt: 0 }]));
}

/** Las cifras del equipo a partir de `events`. opts: { feature }. */
export function metricsOf(events, { feature = '' } = {}) {
  const specs = specsOf(events, feature);
  const developers = counters(({ tier, instructions }) => ({ tier, instructions, deliveries: 0, approved: 0, firstPass: 0, rejected: 0, relaunched: 0, escalated: 0 }));
  const m = {
    reviewers: counters((seed) => ({ ...seed, verdicts: 0, rejections: 0 })), integration: { merged: 0, broke: 0, conflicts: 0 }, leadTimes: [],
    // La fila de quien desarrolla AHORA esta spec: su último despacho o, sin él, el nivel con que empezó.
    developer: (s) => { const config = s.config || { tier: s.tier, instructions: UNKNOWN }; return developers.of(`${config.tier}\n${config.instructions}`, config); }
  };
  for (const event of events) {
    const spec = specs.get(event.spec);
    if (spec && ON[event.type]) ON[event.type](m, spec, event);
  }
  for (const spec of specs.values()) settle(spec);
  const lead = m.leadTimes;
  return {
    specs: specs.size, integrated: m.integration.merged,
    developers: developers.list().sort(sortBy('tier', 'instructions')), reviewers: m.reviewers.list().sort(sortBy('role', 'instructions')),
    integration: m.integration, leadTimeMs: lead.length ? Math.round(lead.reduce((sum, ms) => sum + ms, 0) / lead.length) : null
  };
}
