const BOOLEAN_FLAGS = new Set(['dry-run', 'yes', 'y', 'force', 'allow-exec', 'plan', 'up', 'agent', 'no-ccr', 'repair-plan', 'doctor', 'verify', 'ai']);
const VALUE_FLAGS = new Set(['target', 'method', 'mode', 'stack', 'name', 'lang', 'doc', 'azure', 'pat', 'jira', 'email', 'token', 'url', 'feature', 'spec', 'env', 'surface', 'max-steps', 'profile', 'spec-model', 'qa-model', 'repair-model', 'architecture', 'description']);

function setFlag(out, key, value) {
  if (key in out) out[key] = Array.isArray(out[key]) ? out[key].concat(value) : [out[key], value];
  else out[key] = value;
}

export function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('--') || a === '-') {
      positional.push(a);
      continue;
    }

    const eq = a.indexOf('=');
    const rawKey = a.slice(2, eq === -1 ? undefined : eq);
    const key = rawKey.startsWith('no-') ? rawKey.slice(3) : rawKey;
    if (!key) throw new Error('Flag inválida: --');
    if (rawKey.startsWith('no-')) {
      setFlag(flags, key, false);
      continue;
    }
    if (BOOLEAN_FLAGS.has(key)) {
      setFlag(flags, key, eq === -1 ? true : !['0', 'false', 'no'].includes(a.slice(eq + 1).toLowerCase()));
      continue;
    }
    if (!VALUE_FLAGS.has(key)) throw new Error(`Flag desconocida: --${key}`);
    if (eq !== -1) {
      setFlag(flags, key, a.slice(eq + 1));
      continue;
    }
    const next = args[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`La flag --${key} necesita un valor`);
    setFlag(flags, key, next);
    i++;
  }
  return { flags, positional };
}
