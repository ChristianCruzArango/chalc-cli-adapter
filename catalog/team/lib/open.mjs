// open.mjs — abrir una feature con sus specs (spec 033, R2). Responsabilidad ÚNICA: registrar qué carpetas
// forman una feature. Razón de cambio: qué se exige para que una spec entre al equipo.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Todo o nada: si una carpeta no existe o ya es de otra feature, no se registra ninguna.

import { option, positionals } from './cliargs.mjs';
import { appendEvent, readStatus } from './ledger.mjs';
import { normalPath } from './scope.mjs';
import { isSpecFolder } from './specstate.mjs';

// La primera carpeta que no puede entrar y por qué, o null.
async function rejected(root, folders, status) {
  const taken = new Set(status.features.flatMap((f) => f.specs.map((s) => s.spec)));
  for (const dir of folders) {
    if (!await isSpecFolder(root, dir)) return { problem: 'missing-folder', spec: dir };
    if (taken.has(dir)) return { problem: 'already-registered', spec: dir };
  }
  return null;
}

/** `team.mjs open --feature <nombre> [--agent <agente>] <carpeta…>`. Devuelve el código de salida. */
export async function openFeature(ctx) {
  const feature = option(ctx.args, '--feature');
  const folders = [...new Set(positionals(ctx.args).map(normalPath))];
  if (!feature || !folders.length) { ctx.write(ctx.t.openUsage); return 1; }
  const status = await readStatus(ctx.root, { now: ctx.now });
  const bad = await rejected(ctx.root, folders, status);
  if (bad) { ctx.write(ctx.t.problems[bad.problem](bad.spec)); return 1; }
  if (!status.features.some((f) => f.feature === feature)) {
    await appendEvent(ctx.root, { type: 'feature_opened', feature, agent: option(ctx.args, '--agent') || 'nativo' }, { now: ctx.now });
  }
  for (const spec of folders) await appendEvent(ctx.root, { type: 'spec_added', feature, spec }, { now: ctx.now });
  ctx.write(ctx.t.opened(feature, folders.length));
  return 0;
}
