import { mkdir, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

export function makeAiTrace({ task, provider, model, system, user, output, status = 'ok', error = '', extra = {} }) {
  return {
    ts: new Date().toISOString(),
    task,
    provider,
    model,
    status,
    systemHash: sha256(system),
    userHash: sha256(user),
    outputHash: sha256(output),
    inputChars: String(system ?? '').length + String(user ?? '').length,
    outputChars: String(output ?? '').length,
    ...(error ? { error: String(error).slice(0, 500) } : {}),
    ...extra
  };
}

export async function appendAiTrace(projectPath, specId, record) {
  const file = join(projectPath, 'specs', specId, '.chalc', 'ai-trace.jsonl');
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(record) + '\n', 'utf8');
  return file;
}
