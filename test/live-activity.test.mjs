// T1 (spec 020, R8) — un evento de hook se convierte en UNA línea del registro de actividad.
//
// Los eventos son los que manda Claude Code de verdad (capturados en el demo): dentro de un subagente
// traen `agent_type` y `agent_id`; el agente principal no trae ninguno de los dos. La línea dice quién,
// qué herramienta y un resumen (ruta o comando), y NUNCA el contenido: ni el de un archivo que se escribe,
// ni el de la respuesta, ni el prompt de un subagente. Lo que pudiera ser secreto se redacta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { activityOf, lastLines, MAX_LINES, ACTIVITY_REL } from '../catalog/live/lib/activity.mjs';

const ROOT = '/home/u/app';
const AT = new Date('2026-10-13T20:22:23.000Z');
const ev = (over) => ({ session_id: 's', cwd: ROOT, hook_event_name: 'PreToolUse', ...over });

test('R8: the registry lives in .chalc and is bounded', () => {
  assert.equal(ACTIVITY_REL, '.chalc/activity.jsonl');
  assert.equal(MAX_LINES, 500);
});

test('R8: a tool used by the main agent is attributed to the main agent, with the path relative to the root', () => {
  assert.deepEqual(activityOf(ev({ tool_name: 'Read', tool_input: { file_path: `${ROOT}/src/app.ts` } }), { root: ROOT, now: AT }), {
    at: '2026-10-13T20:22:23.000Z', who: 'principal', kind: 'tool', tool: 'Read', summary: 'src/app.ts'
  });
});

test('R8: a tool used inside a role is attributed to that role', () => {
  const line = activityOf(ev({ agent_id: 'a29', agent_type: 'revisor', tool_name: 'Grep', tool_input: { pattern: 'Saludo', path: `${ROOT}/src` } }), { root: ROOT, now: AT });
  assert.deepEqual([line.who, line.tool, line.summary], ['revisor', 'Grep', 'Saludo · src']);
});

test('R8: a role entering and leaving is recorded, and so is the end of a turn', () => {
  assert.deepEqual(activityOf({ hook_event_name: 'SubagentStart', agent_id: 'a29', agent_type: 'seguridad' }, { root: ROOT, now: AT }), { at: AT.toISOString(), who: 'seguridad', kind: 'start' });
  assert.deepEqual(activityOf({ hook_event_name: 'SubagentStop', agent_id: 'a29', agent_type: 'seguridad' }, { root: ROOT, now: AT }), { at: AT.toISOString(), who: 'seguridad', kind: 'stop' });
  assert.deepEqual(activityOf({ hook_event_name: 'Stop' }, { root: ROOT, now: AT }), { at: AT.toISOString(), who: 'principal', kind: 'turn-end' });
});

test('R8: launching a role says which role and what for, never its prompt', () => {
  const line = activityOf(ev({ tool_name: 'Agent', tool_input: { subagent_type: 'revisor', description: 'Revisar T2', prompt: 'TEXTO LARGO DEL PROMPT' } }), { root: ROOT, now: AT });
  assert.equal(line.summary, 'revisor · Revisar T2');
  assert.ok(!JSON.stringify(line).includes('TEXTO LARGO'));
});

test('R8: what is written is never recorded, only where', () => {
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    const line = activityOf(ev({ tool_name: tool, tool_input: { file_path: `${ROOT}/src/a.ts`, content: 'SECRETO', old_string: 'X', new_string: 'SECRETO', edits: [{ new_string: 'SECRETO' }] } }), { root: ROOT, now: AT });
    assert.equal(line.summary, 'src/a.ts', tool);
    assert.ok(!JSON.stringify(line).includes('SECRETO'), tool);
  }
});

test('R8: a shell command is summarised, shortened and redacted', () => {
  const token = 'ghp_' + 'a'.repeat(36);
  const line = activityOf(ev({ tool_name: 'Bash', tool_input: { command: `curl -H "Authorization: Bearer ${token}" https://api.x && ${'npm test '.repeat(30)}` } }), { root: ROOT, now: AT });
  assert.ok(!line.summary.includes(token), line.summary);
  assert.ok(line.summary.length <= 121, String(line.summary.length));
  assert.ok(line.summary.endsWith('…'));
});

test('R8: a file outside the root keeps its absolute path; other tools keep only their name', () => {
  assert.equal(activityOf(ev({ tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } }), { root: ROOT, now: AT }).summary, '/etc/hosts');
  assert.deepEqual(activityOf(ev({ tool_name: 'WebFetch', tool_input: { url: 'https://x', prompt: 'p' } }), { root: ROOT, now: AT }), {
    at: AT.toISOString(), who: 'principal', kind: 'tool', tool: 'WebFetch', summary: ''
  });
  assert.equal(activityOf(ev({ tool_name: 'Glob', tool_input: { pattern: '**/*.ts' } }), { root: ROOT, now: AT }).summary, '**/*.ts');
});

test('R9: an event that is not one of these, or unreadable, gives no line', () => {
  for (const event of [undefined, null, {}, { hook_event_name: 'PostToolUse', tool_name: 'Read' }, { hook_event_name: 'Notification' }, 'texto']) {
    assert.equal(activityOf(event, { root: ROOT, now: AT }), null, JSON.stringify(event));
  }
});

test('R8: only the last N lines are kept, in order', () => {
  const lines = Array.from({ length: 7 }, (_, i) => `l${i}`);
  assert.deepEqual(lastLines(lines.join('\n') + '\n', 3), ['l4', 'l5', 'l6']);
  assert.deepEqual(lastLines('', 3), []);
  assert.deepEqual(lastLines('a\n\nb\n', 5), ['a', 'b']);
});

// Los casos de abajo salen de la pasada de mutación.

test('R8: notebooks are summarised by their path too', () => {
  assert.equal(activityOf(ev({ tool_name: 'NotebookEdit', tool_input: { notebook_path: `${ROOT}/n.ipynb`, new_source: 'X' } }), { root: ROOT, now: AT }).summary, 'n.ipynb');
  assert.equal(activityOf(ev({ tool_name: 'NotebookRead', tool_input: { notebook_path: `${ROOT}/n.ipynb` } }), { root: ROOT, now: AT }).summary, 'n.ipynb');
});

test('R8: exactly 120 characters are kept whole; whitespace and line breaks collapse', () => {
  const exact = 'a'.repeat(120);
  assert.equal(activityOf(ev({ tool_name: 'Bash', tool_input: { command: exact } }), { root: ROOT, now: AT }).summary, exact);
  assert.equal(activityOf(ev({ tool_name: 'Bash', tool_input: { command: '  npm   test\n  && ls  ' } }), { root: ROOT, now: AT }).summary, 'npm test && ls');
});

test('R8: a relative path is shown as given; without a root the event cwd is the root', () => {
  assert.equal(activityOf(ev({ tool_name: 'Read', tool_input: { file_path: 'src/a.ts' } }), { root: ROOT, now: AT }).summary, 'src/a.ts');
  assert.equal(activityOf(ev({ tool_name: 'Read', tool_input: { file_path: `${ROOT}/src/b.ts` } }), { now: AT }).summary, 'src/b.ts');
  assert.equal(activityOf({ ...ev({ tool_name: 'Read', tool_input: { file_path: `${ROOT}/src/b.ts` } }), cwd: '' }, { now: AT }).summary, `${ROOT}/src/b.ts`);
  assert.equal(activityOf(ev({ tool_name: 'Read', tool_input: {} }), { root: ROOT, now: AT }).summary, '');
});

test('R8: grep without a path, and a role launched with the old Task tool or without description', () => {
  assert.equal(activityOf(ev({ tool_name: 'Grep', tool_input: { pattern: 'x' } }), { root: ROOT, now: AT }).summary, 'x');
  assert.equal(activityOf(ev({ tool_name: 'Task', tool_input: { subagent_type: 'endurecedor', description: 'Cierre' } }), { root: ROOT, now: AT }).summary, 'endurecedor · Cierre');
  assert.equal(activityOf(ev({ tool_name: 'Agent', tool_input: { subagent_type: 'revisor' } }), { root: ROOT, now: AT }).summary, 'revisor');
});

test('R9: a tool event without a tool name, or with tool_input missing, is handled', () => {
  assert.equal(activityOf(ev({}), { root: ROOT, now: AT }), null);
  assert.equal(activityOf(ev({ tool_name: 'Bash' }), { root: ROOT, now: AT }).summary, '');
});

test('R8: by default the last 500 lines are kept', () => {
  assert.equal(lastLines(Array.from({ length: 600 }, (_, i) => `l${i}`).join('\n')).length, 500);
});
