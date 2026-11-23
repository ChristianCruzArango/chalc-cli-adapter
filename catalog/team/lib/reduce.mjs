// reduce.mjs — el estado del equipo a partir de su registro (spec 032, R4–R7). Responsabilidad ÚNICA: convertir
// la lista de eventos en lo que el usuario necesita ver. Razón de cambio: qué se muestra de cada feature y spec.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO: no lee disco ni reloj (`now` llega por parámetro). El estado no se guarda en ningún otro sitio: se
// recalcula entero desde el registro, así que nadie puede «editar en qué va» una spec sin dejar un evento.

const newSpec = (spec, at, maxAttempts) => ({
  spec, state: 'draft', wave: null, worktree: '', branch: '', developer: { launcher: '', tier: '' },
  phase: '', task: '', attempt: 0, maxAttempts, relaunched: false, lastGate: null, lastFinding: '', blockedBy: '', lastSignal: at
});

// Qué hace cada evento con SU spec. `s.rejected` y `s.before` son internos: no salen en el estado.
const ON_SPEC = {
  spec_approved: (s) => { s.state = 'approved'; },
  scheduled: (s, e) => { s.state = 'scheduled'; s.wave = e.wave; },
  started: (s, e) => { Object.assign(s, { state: 'in_dev', worktree: e.worktree, branch: e.branch, attempt: 1 }); s.developer = { launcher: e.launcher, tier: e.tier }; },
  // No cambia el estado: es una señal de que alguien acaba de ponerse con la spec.
  dispatched: () => {},
  signal: (s, e) => { s.phase = e.phase || s.phase; s.task = e.task || s.task; },
  gate: (s, e) => { s.lastGate = { verdict: e.verdict, stage: e.stage || '', score: e.score ?? null, fast: e.fast === true, at: e.at }; },
  // Una entrega nueva empieza limpia: los rechazos de la anterior ya se respondieron con el rework.
  delivered: (s) => { s.state = 'delivered'; s.rejected = false; },
  reviewed: (s, e) => {
    if (!e.ok) Object.assign(s, { state: 'rejected', rejected: true, lastFinding: `${e.role}: ${e.summary}` });
    // El OK de un rol no borra el rechazo de otro sobre la MISMA entrega.
    else if (!s.rejected) s.state = 'reviewed_ok';
  },
  rework: (s) => { s.state = 'in_dev'; s.attempt += 1; },
  // Otro desarrollador, con un modelo superior: los intentos empiezan de nuevo, y queda dicho que ya se relanzó.
  relaunched: (s, e) => { Object.assign(s, { state: 'in_dev', attempt: 1, relaunched: true }); s.developer = { ...s.developer, tier: e.tier }; },
  escalated: (s, e) => { s.state = 'escalated'; s.blockedBy = e.reason; },
  blocked: (s, e) => { s.before = s.state; s.state = 'blocked'; s.blockedBy = e.reason; },
  unblocked: (s) => { s.state = s.before || s.state; s.blockedBy = ''; },
  integrated: (s) => { s.state = 'integrated'; }
};

const ON_FEATURE = {
  lead: (f, e) => { f.lead = { ...f.lead, action: e.action, since: e.at }; },
  closed: (f) => { f.closed = true; },
  needs_human: (f, e) => { f.waiting = { feature: f.feature, reason: e.reason, command: e.command, since: e.at }; },
  human_done: (f) => { f.waiting = null; }
};

function apply(model, event, maxAttempts) {
  if (event.type === 'feature_opened') {
    model.features.set(event.feature, { feature: event.feature, closed: false, lead: { agent: event.agent, action: '', since: event.at }, specs: [], waiting: null });
  } else if (event.type === 'spec_added') {
    const spec = newSpec(event.spec, event.at, maxAttempts);
    model.features.get(event.feature)?.specs.push(spec);
    model.specs.set(event.spec, spec);
  } else if (ON_SPEC[event.type]) {
    const spec = model.specs.get(event.spec);
    // Un evento de una spec que nadie registró no puede inventar su estado: se ignora.
    if (spec) { ON_SPEC[event.type](spec, event); spec.lastSignal = event.at; }
  } else if (ON_FEATURE[event.type]) {
    const feature = model.features.get(event.feature);
    if (feature) ON_FEATURE[event.type](feature, event);
  }
}

// Solo se atasca quien está trabajando: una spec en desarrollo que lleva demasiado sin dar señal.
const shown = ({ rejected, before, ...spec }, now, stallMs) => ({ ...spec, stalled: spec.state === 'in_dev' && now - Date.parse(spec.lastSignal) > stallMs });

/** El estado del equipo: { updated, waitingHuman, features }. opts: { now (ms), stallMs, maxAttempts }. */
export function reduce(events, { now, stallMs, maxAttempts }) {
  const model = { features: new Map(), specs: new Map() };
  for (const event of events) apply(model, event, maxAttempts);
  const features = [...model.features.values()];
  return {
    updated: new Date(now).toISOString(),
    waitingHuman: features.map((f) => f.waiting).filter(Boolean),
    features: features.map(({ waiting, specs, ...feature }) => ({ ...feature, specs: specs.map((spec) => shown(spec, now, stallMs)) }))
  };
}
