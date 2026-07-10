import { c, stripAnsi } from './render.mjs';

const LABEL = {
  es: { title: 'AGENTES', planner: 'Líder', coder: 'Desarrollador', reviewer: 'Revisor', idle: 'inactivo', running: 'trabajando', waiting_approval: 'espera aprobación', completed: 'completado', failed: 'falló', interrupted: 'interrumpido', task: 'tarea' },
  en: { title: 'AGENTS', planner: 'Leader', coder: 'Developer', reviewer: 'Reviewer', idle: 'idle', running: 'working', waiting_approval: 'waiting approval', completed: 'completed', failed: 'failed', interrupted: 'interrupted', task: 'task' }
};

const icon = (s) => ({ running: c.cyan('●'), waiting_approval: c.yellow('◆'), completed: c.green('✓'), failed: c.red('✗'), interrupted: c.yellow('■'), idle: c.dim('○') })[s] || c.dim('○');
const elapsed = (a, end, now) => {
  if (!a) return '--:--';
  const sec = Math.max(0, Math.floor(((end || now) - a) / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};
const cut = (v, n) => { const s = String(v || ''); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; };
const pad = (v, n) => v + ' '.repeat(Math.max(0, n - stripAnsi(v).length));

export function renderAgents(snapshot, { language = 'es', width = 80, now = Date.now() } = {}) {
  const x = LABEL[language === 'en' ? 'en' : 'es'];
  const agents = snapshot?.agents || [];
  const inner = Math.max(38, Math.min(100, width - 4));
  const lines = [];
  for (const a of agents) {
    const name = pad(x[a.role] || a.role, 13);
    const status = pad(x[a.status] || a.status, 17);
    const time = elapsed(a.startedAt, a.finishedAt, now);
    const model = cut([a.model, a.provider && `(${a.provider})`].filter(Boolean).join(' '), Math.max(8, inner - 44));
    lines.push(`${icon(a.status)} ${name} ${status} ${time}  ${model}`.trimEnd());
    const detail = a.currentAction || a.task;
    if (detail) lines.push(c.dim(`  └─ ${cut(a.currentAction || `${x.task}: ${detail}`, inner - 8)}`));
  }
  const states = agents.map((a) => `${icon(a.status)} ${x[a.role]}`).join(c.dim(' ─── '));
  lines.push('', states);
  const bar = (l, r, title = '') => c.gray(l + (title ? `─ ${title} ` : '') + '─'.repeat(Math.max(0, inner - stripAnsi(title).length - (title ? 3 : 0))) + r);
  return [bar('╭', '╮', x.title), ...lines.map((line) => c.gray('│') + ' ' + pad(line, inner - 2) + ' ' + c.gray('│')), bar('╰', '╯')].join('\n');
}
