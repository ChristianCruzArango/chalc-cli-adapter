// probe.mjs — las sondas de una spec en la línea de comandos (spec 041). Responsabilidad ÚNICA: recibir el
// comando, ejecutar las sondas, guardar el resultado y fijar el código de salida. Razón de cambio: qué comandos hay.
//
// Este archivo lo emite chalc dentro de `.chalc/probe/`. Se ejecuta con `node .chalc/probe.mjs` y se REGENERA al
// equipar el repo: no lo edites. Las sondas viven en `probes.json`, dentro de la carpeta de cada spec.
//
// Tres salidas, como la medición de interfaz: 0 cumplen, 1 alguna falla, 2 NO SE PUDO EJECUTAR.

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { textOf } from './lib/i18n.mjs';
import { parseProbes } from './lib/probes.mjs';
import { localUrl, runApi, runCli } from './lib/run.mjs';

export const OUT_REL = '.chalc/probe-out';
export const CANNOT_RUN = 2;

const option = (args, name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] || '' : ''; };

async function languageOf(root) {
  try { return JSON.parse(await readFile(join(root, '.chalc', 'gate.json'), 'utf8')).language || 'en'; } catch { return 'en'; }
}

// El commit que se sondeó, o '' fuera de un repo de git.
function headOf(root) {
  const run = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  return run.status === 0 ? run.stdout.trim() : '';
}

// Las sondas de `spec` listas para correr: { probes } o { refusal } con el porqué.
async function loaded(ctx, spec) {
  let text;
  try { text = await readFile(join(ctx.root, ...spec.split('/'), 'probes.json'), 'utf8'); } catch { return { refusal: ctx.t.noProbes(spec) }; }
  const probes = parseProbes(text);
  if (probes.problem) return { refusal: ctx.t.malformed(spec, probes.problem) };
  const remote = ctx.args.includes('--allow-remote') ? null : probes.api.find((probe) => !localUrl(probe.url));
  return remote ? { refusal: ctx.t.notLocal(remote.url) } : { probes };
}

async function save(ctx, spec, results) {
  const failures = results.filter((r) => !r.ok).length;
  const dir = join(ctx.root, ...OUT_REL.split('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'results.json'), JSON.stringify({ commit: headOf(ctx.root), spec, failures, probes: results }, null, 2) + '\n', 'utf8');
  return failures;
}

async function runCommand(ctx) {
  const spec = option(ctx.args, '--spec').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!spec) { ctx.write(ctx.t.usage); return 1; }
  const { probes, refusal } = await loaded(ctx, spec);
  if (refusal) { ctx.write(refusal); return CANNOT_RUN; }
  const results = [];
  for (const probe of probes.api) results.push(await runApi(probe));
  for (const probe of probes.cli) results.push(await runCli(probe, { cwd: ctx.root }));
  const failures = await save(ctx, spec, results);
  for (const r of results.filter((x) => !x.ok)) for (const m of r.mismatches) ctx.write(ctx.t.mismatch(r.name, m));
  ctx.write(failures ? ctx.t.failed(failures, results.length) : ctx.t.clean(results.length));
  ctx.write(ctx.t.savedIn(OUT_REL));
  return failures ? 1 : 0;
}

/** Entrada de línea de comandos. Devuelve el código de salida. `write` y `cwd` se inyectan en los tests. */
export async function main({ argv = process.argv, cwd = process.cwd(), write = (text) => process.stdout.write(`${text}\n`) } = {}) {
  const [command, ...args] = argv.slice(2);
  const t = textOf(await languageOf(cwd));
  if (command !== 'run') { write(t.usage); return 1; }
  return runCommand({ root: cwd, t, args, write });
}

// Solo corre cuando se invoca el archivo, no al importarlo desde los tests de chalc.
if (process.argv[1] && /probe\.mjs$/.test(process.argv[1])) process.exit(await main());
