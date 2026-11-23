// team.mjs — el orquestador del equipo (spec 032). Responsabilidad ÚNICA: recibir un comando, registrarlo o
// mostrar el estado, y fijar el código de salida. Razón de cambio: qué comandos tiene el equipo.
//
// Este archivo lo emite chalc dentro de `.chalc/team/`. Se ejecuta con `node .chalc/team.mjs` y se REGENERA al
// equipar el repo: no lo edites.
//
// No es un modelo ni lanza ninguno: guarda hechos y los muestra. `status.json` y el informe salen solo del
// registro, para que lo que el usuario lee no dependa de cómo lo cuente nadie.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { option, parsePairs, positionals } from './lib/cliargs.mjs';
import { closeFeature } from './lib/close.mjs';
import { deliverSpec } from './lib/deliver.mjs';
import { dispatchRole } from './lib/dispatch.mjs';
import { evalsCommand } from './lib/evalscmd.mjs';
import { textOf } from './lib/i18n.mjs';
import { integrateFeature } from './lib/integrate.mjs';
import { appendEvent, readLedger, refreshStatus, teamOptions } from './lib/ledger.mjs';
import { openFeature } from './lib/open.mjs';
import { renderStatus } from './lib/render.mjs';
import { renderReport } from './lib/report.mjs';
import { reworkSpec } from './lib/rework.mjs';
import { mainRoot } from './lib/root.mjs';
import { scheduleWaves } from './lib/schedule.mjs';
import { verdictOf } from './lib/verdict.mjs';
import { galleryOf } from './lib/uicheck.mjs';
import { startSpec } from './lib/worktree.mjs';

export { parsePairs };

// El idioma del proyecto (el del portón). Sin él, inglés.
async function languageOf(root) {
  try { return JSON.parse(await readFile(join(root, '.chalc', 'gate.json'), 'utf8')).language || 'en'; } catch { return 'en'; }
}

async function record(ctx, event) {
  const out = await appendEvent(ctx.root, event, { now: ctx.now });
  ctx.write(out.ok ? ctx.t.registered(out.event.type) : ctx.t.refused(out.reason));
  return out.ok ? 0 : 1;
}

const COMMANDS = {
  status: async (ctx) => { ctx.write(renderStatus(await refreshStatus(ctx.root, { now: ctx.now }), ctx.lang)); return 0; },
  report: async (ctx) => {
    const feature = option(ctx.args, '--feature');
    if (!feature) { ctx.write(ctx.t.reportUsage); return 1; }
    ctx.write(renderReport(await readLedger(ctx.root), feature, { lang: ctx.lang, now: ctx.now().getTime(), ...await teamOptions(ctx.root) }));
    // Las capturas que existen (spec 040, R6): para verlas ANTES de aprobar el cierre.
    const specs = (await refreshStatus(ctx.root, { now: ctx.now })).features.find((f) => f.feature === feature)?.specs || [];
    const galleries = specs.map((s) => [s.spec, s.worktree ? galleryOf(s.worktree) : '']).filter(([, file]) => file);
    if (galleries.length) ctx.write([`## ${ctx.t.report.galleries}`, ...galleries.map(([spec, file]) => `- ${spec}: ${file}`), ''].join('\n'));
    return 0;
  },
  // Un rol que no puede seguir lo deja escrito, con su porqué: no le pregunta al usuario, sube por aquí.
  block: async (ctx) => {
    const spec = option(ctx.args, '--spec');
    const reason = positionals(ctx.args)[0] || '';
    if (!spec || !reason.trim()) { ctx.write(ctx.t.blockUsage); return 1; }
    return record(ctx, { type: 'blocked', spec, reason });
  },
  open: openFeature,
  waves: scheduleWaves,
  start: startSpec,
  deliver: deliverSpec,
  dispatch: dispatchRole,
  verdict: verdictOf,
  rework: reworkSpec,
  integrate: integrateFeature,
  close: closeFeature,
  evals: evalsCommand,
  event: async (ctx) => record(ctx, { ...parsePairs(ctx.args.slice(1)), type: ctx.args[0] })
};

/** Entrada de línea de comandos. Devuelve el código de salida. `write`, `cwd` y `now` se inyectan en los tests. */
export async function main({ argv = process.argv, cwd = process.cwd(), write = (text) => process.stdout.write(`${text}\n`), now = () => new Date() } = {}) {
  const [command, ...args] = argv.slice(2);
  const root = mainRoot(cwd, args);
  const lang = await languageOf(root);
  const t = textOf(lang);
  if (!COMMANDS[command]) { write(t.usage); return 1; }
  return COMMANDS[command]({ root, cwd, lang, t, args, write, now });
}

// Solo corre cuando se invoca el archivo, no al importarlo desde los tests de chalc.
if (process.argv[1] && /team\.mjs$/.test(process.argv[1])) process.exit(await main());
