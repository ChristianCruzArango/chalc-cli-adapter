// evalscmd.mjs — el comando `evals` (spec 037, R2–R6). Responsabilidad ÚNICA: mostrar las cifras del equipo como
// tabla o como datos. Razón de cambio: cómo se presentan.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.

import { option } from './cliargs.mjs';
import { readLedger } from './ledger.mjs';
import { metricsOf } from './metrics.mjs';

const minutes = (ms) => (ms === null ? '—' : `${Math.round(ms / 60000)} min`);

// Filas alineadas por columnas.
function table(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
  return rows.map((row) => '  ' + row.map((cell, column) => String(cell).padEnd(widths[column])).join('  ').trimEnd());
}

function render(metrics, e) {
  if (!metrics.developers.length && !metrics.reviewers.length) return e.empty;
  const d = e.columns;
  return [
    `${e.title} · ${metrics.specs} ${e.specs} · ${metrics.integrated} ${e.integrated}`, '',
    e.developers, ...table([[d.tier, d.instructions, d.deliveries, d.firstPass, d.approved, d.rejected, d.relaunched, d.escalated],
      ...metrics.developers.map((r) => [r.tier, r.instructions, r.deliveries, r.firstPass, r.approved, r.rejected, r.relaunched, r.escalated])]), '',
    e.reviewers, ...table([[d.role, d.instructions, d.verdicts, d.rejections], ...metrics.reviewers.map((r) => [r.role, r.instructions, r.verdicts, r.rejections])]), '',
    `${e.integration}: ${metrics.integration.merged} ${d.merged} · ${metrics.integration.broke} ${d.broke} · ${metrics.integration.conflicts} ${d.conflicts}`,
    `${e.leadTime}: ${minutes(metrics.leadTimeMs)}`, '', e.caveat
  ].join('\n');
}

/** `team.mjs evals [--feature <nombre>] [--json]`. Devuelve el código de salida. */
export async function evalsCommand(ctx) {
  const metrics = metricsOf(await readLedger(ctx.root), { feature: option(ctx.args, '--feature') });
  ctx.write(ctx.args.includes('--json') ? JSON.stringify(metrics, null, 2) : render(metrics, ctx.t.evals));
  return 0;
}
