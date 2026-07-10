// Estado observable de las ejecuciones de agentes. No conoce la terminal ni el motor:
// session.mjs publica aquí los cambios y cualquier frontend puede tomar una instantánea.

const ROLES = ['planner', 'coder', 'reviewer'];
const now = () => Date.now();

function publicRun(run) {
  return { ...run, steps: [...run.steps] };
}

export function createAgentRegistry({ roles = {} } = {}) {
  let seq = 0;
  const runs = [];
  const listeners = new Set();
  const emit = () => {
    const value = snapshot();
    for (const fn of listeners) fn(value);
  };
  const find = (id) => runs.find((r) => r.id === id);

  function begin({ role, task, model, provider } = {}) {
    const run = {
      id: `a${++seq}`, role: role || 'coder', task: String(task || '').trim(),
      model: model || roles[role]?.model || '', provider: provider || roles[role]?.provider || '',
      status: 'running', currentAction: '', startedAt: now(), finishedAt: null,
      steps: [], error: ''
    };
    runs.push(run);
    emit();
    return run.id;
  }

  function update(id, patch = {}) {
    const run = find(id);
    if (!run) return false;
    Object.assign(run, patch);
    emit();
    return true;
  }

  function step(id, entry) {
    const run = find(id);
    if (!run) return false;
    const tool = entry?.action?.tool || '';
    const args = entry?.action?.args || {};
    const target = args.path || args.file || args.command || args.cmd || '';
    run.currentAction = [tool, target].filter(Boolean).join(' ');
    run.steps.push({ tool, target: String(target), at: now(), error: entry?.observation?.error || '' });
    emit();
    return true;
  }

  function finish(id, result = {}) {
    const run = find(id);
    if (!run) return false;
    run.status = result.interrupted ? 'interrupted' : result.ok === false || result.done === false ? 'failed' : 'completed';
    run.error = result.error || '';
    run.currentAction = '';
    run.finishedAt = now();
    emit();
    return true;
  }

  function fail(id, error) {
    return finish(id, { ok: false, error: error?.message || String(error || '') });
  }

  function snapshot() {
    const latest = new Map();
    for (const run of runs) latest.set(run.role, run);
    return {
      at: now(),
      agents: ROLES.map((role) => {
        const run = latest.get(role);
        return run ? publicRun(run) : {
          id: null, role, task: '', model: roles[role]?.model || '', provider: roles[role]?.provider || '',
          status: 'idle', currentAction: '', startedAt: null, finishedAt: null, steps: [], error: ''
        };
      }),
      runs: runs.map(publicRun)
    };
  }

  return {
    begin, update, step, finish, fail, snapshot,
    active(role) { return [...runs].reverse().find((r) => r.role === role && ['running', 'waiting_approval'].includes(r.status))?.id || null; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}
