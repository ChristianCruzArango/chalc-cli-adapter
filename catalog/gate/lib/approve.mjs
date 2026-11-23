// approve.mjs — la aprobación de la spec por el usuario (spec 024, R14, R15). Responsabilidad ÚNICA: decidir si
// se puede sellar y sellar. Razón de cambio: las condiciones de una aprobación.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Aprueba una PERSONA: hace falta una terminal interactiva y teclear el nombre de la carpeta. Un asistente
// que lanza el comando desde su shell no tiene terminal, y la guarda además se lo deniega. Quien tiene shell
// puede simular una terminal o escribir el sello: esto sube el listón y deja rastro, no es inviolable.

import { basename } from 'node:path';
import { logApproval } from './approvals.mjs';
import { headCommit } from './changed.mjs';
import { RULES } from './rules.mjs';
import { specFacts } from './specfacts.mjs';
import { writeSeal } from './specseal.mjs';

/**
 * Sella la carpeta activa de `root`. opts: { specDir, isTTY, ask(nombre) → texto tecleado, now(), head(root) }.
 * Devuelve { ok, reason, dir, file, problems }; reason: '' | no-spec | problems | no-terminal | name-mismatch.
 */
export async function approveSpec(root, { specDir = 'specs', isTTY = false, ask, now = () => new Date(), head = headCommit } = {}) {
  const facts = await specFacts(root, specDir);
  const refused = (reason, problems = []) => ({ ok: false, reason, dir: facts.dir, file: '', problems });
  if (!facts.dir) return refused('no-spec', facts.problems);
  // Una HU cambiada tras el sello se resuelve justo aquí, re-aprobando: no puede impedir la aprobación.
  const problems = facts.problems.filter((p) => p.rule !== RULES.huChanged);
  if (problems.length) return refused('problems', problems);
  if (!isTTY) return refused('no-terminal');
  const name = basename(facts.dir);
  if (String(await ask(name)).trim() !== name) return refused('name-mismatch');
  const date = now().toISOString();
  const file = await writeSeal(root, { dir: facts.dir, hu: facts.huHash, fingerprint: facts.fingerprint, date });
  // El rastro (spec 028, R10): qué se aprobó y sobre qué commit, también si después se vuelve a sellar.
  await logApproval(root, { kind: 'spec', dir: facts.dir, fingerprint: facts.fingerprint, head: (await head(root)) || '', date });
  return { ok: true, reason: '', dir: facts.dir, file, problems: [] };
}
