// approvals.mjs — el rastro de las aprobaciones del usuario (spec 028, R10). Responsabilidad ÚNICA: añadir una
// línea por aprobación a `.chalc/approvals.jsonl`. Razón de cambio: qué se registra de una aprobación.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// El sello dice si algo ESTÁ aprobado; esto dice qué se aprobó y cuándo, también lo que después se re-selló.
// Solo se añade: una línea nueva nunca reescribe las anteriores.

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const APPROVALS_REL = '.chalc/approvals.jsonl';

/** Añade al rastro la aprobación `{ kind, dir, fingerprint, head, date }`. */
export async function logApproval(root, { kind, dir, fingerprint, head, date }) {
  const file = join(root, ...APPROVALS_REL.split('/'));
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify({ kind, dir, fingerprint, head, date }) + '\n', 'utf8');
}
