// Estado de las ejecuciones de agentes. No conoce la terminal ni el motor: session.mjs anota aquí
// los cambios y cualquier frontend puede tomar una instantánea (`/agents`).

const ROLES = ['planner', 'coder', 'reviewer'];
// Historial acotado: una sesión larga abre un run por turno, y guardarlos todos con sus pasos
// hacía crecer la memoria sin fin. Se descartan los más viejos que ya terminaron y tienen otro más
// reciente del mismo rol; el último de cada rol y los que siguen en curso no se tocan nunca.
const MAX_RUNS = 50;
const now = () => Date.now();

function publicRun(run) {
  return { ...run, steps: [...run.steps] };
}

function idleAgent(role, roles) {
  return {
    id: null, role, task: '', model: roles[role]?.model || '', provider: roles[role]?.provider || '',
    status: 'idle', currentAction: '', startedAt: null, finishedAt: null, steps: [], error: ''
  };
}

function trim(runs) {
  while (runs.length > MAX_RUNS) {
    const i = runs.findIndex((r, idx) => r.finishedAt !== null && runs.slice(idx + 1).some((n) => n.role === r.role));
    if (i < 0) return;
    runs.splice(i, 1);
  }
}

// Anota un paso del agente: qué herramienta y sobre qué, que es lo que se ve como "acción en curso".
function recordStep(run, entry) {
  const tool = entry?.action?.tool || '';
  const args = entry?.action?.args || {};
  const target = args.path || args.file || args.command || args.cmd || '';
  run.currentAction = [tool, target].filter(Boolean).join(' ');
  run.steps.push({ tool, target: String(target), at: now(), error: entry?.observation?.error || '' });
}

function closeRun(run, result) {
  run.status = result.interrupted ? 'interrupted' : result.ok === false || result.done === false ? 'failed' : 'completed';
  run.error = result.error || '';
  run.currentAction = '';
  run.finishedAt = now();
}

function snapshotOf(runs, roles) {
  const latest = new Map();
  for (const run of runs) latest.set(run.role, run);
  return {
    at: now(),
    agents: ROLES.map((role) => (latest.has(role) ? publicRun(latest.get(role)) : idleAgent(role, roles))),
    runs: runs.map(publicRun)
  };
}

export function createAgentRegistry({ roles = {} } = {}) {
  let seq = 0;
  const runs = [];
  // Cada operación sobre un run inexistente devuelve false, sin lanzar: el registro es observación.
  const withRun = (id, fn) => {
    const run = runs.find((r) => r.id === id);
    if (!run) return false;
    fn(run);
    return true;
  };

  function begin({ role, task, model, provider } = {}) {
    const run = {
      id: `a${++seq}`, role: role || 'coder', task: String(task || '').trim(),
      model: model || roles[role]?.model || '', provider: provider || roles[role]?.provider || '',
      status: 'running', currentAction: '', startedAt: now(), finishedAt: null,
      steps: [], error: ''
    };
    runs.push(run);
    trim(runs);
    return run.id;
  }

  const finish = (id, result = {}) => withRun(id, (run) => closeRun(run, result));
  return {
    begin,
    update: (id, patch = {}) => withRun(id, (run) => Object.assign(run, patch)),
    step: (id, entry) => withRun(id, (run) => recordStep(run, entry)),
    finish,
    fail: (id, error) => finish(id, { ok: false, error: error?.message || String(error || '') }),
    snapshot: () => snapshotOf(runs, roles),
    active(role) { return [...runs].reverse().find((r) => r.role === role && ['running', 'waiting_approval'].includes(r.status))?.id || null; }
  };
}
