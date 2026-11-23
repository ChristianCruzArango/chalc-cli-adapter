// measurecmd.mjs — el comando `measure` (spec 039, R2–R5). Responsabilidad ÚNICA: medir unas URL, guardar medidas
// y capturas, evaluarlas y fijar el código de salida. Razón de cambio: qué hace `measure`.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Tres salidas distintas, a propósito: 0 cumple, 1 hay hallazgos, 2 NO SE PUDO MEDIR. «No pude medir» nunca se
// confunde con «todo bien»: una interfaz que nadie midió no está aprobada.

import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readContract } from './contract.mjs';
import { evaluate } from './evaluate.mjs';
import { galleryHtml } from './gallery.mjs';
import { messageOf } from './i18n.mjs';
import { localOnly, measurePages } from './measure.mjs';

export const OUT_REL = '.chalc/design-out';
export const CANNOT_MEASURE = 2;

const fileName = (name) => `${name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.png`;

// El commit que se midió, o '' fuera de un repo de git: ata la medición al código que la produjo (spec 040, R1).
function headOf(root) {
  const run = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  return run.status === 0 ? run.stdout.trim() : '';
}

// Guarda cada captura, el JSON de medidas (con el nombre de su captura, no con sus bytes) y la galería.
async function save(ctx, measurements, findings) {
  const root = ctx.root;
  const dir = join(root, ...OUT_REL.split('/'));
  await mkdir(dir, { recursive: true });
  const viewports = [];
  for (const { screenshot, ...view } of measurements.viewports) {
    await writeFile(join(dir, fileName(view.name)), screenshot);
    viewports.push({ ...view, screenshot: fileName(view.name) });
  }
  const saved = { commit: headOf(root), findings: findings.length, viewports };
  await writeFile(join(dir, 'measurements.json'), JSON.stringify(saved, null, 2) + '\n', 'utf8');
  await writeFile(join(dir, 'gallery.html'), galleryHtml({ measurements: saved, findings, lang: ctx.lang }), 'utf8');
}

// Mide con el navegador ya lanzado y lo cierra SIEMPRE. Devuelve las medidas, o lanza con el porqué.
async function measured(browser, request) {
  try { return await measurePages(browser.session, request); } finally { await browser.close(); }
}

function report(ctx, findings) {
  for (const finding of findings) ctx.write(messageOf(finding, ctx.lang));
  ctx.write(findings.length ? ctx.t.found(findings.length) : ctx.t.clean);
  ctx.write(ctx.t.savedIn(OUT_REL));
  return findings.length ? 1 : 0;
}

/** `design.mjs measure <url…> [--spec <carpeta>] [--allow-remote]`. Devuelve 0, 1 o 2. */
export async function measureCommand(ctx) {
  const urls = ctx.positionals;
  if (!urls.length) { ctx.write(ctx.t.usage); return 1; }
  const remote = ctx.args.includes('--allow-remote') ? '' : urls.find((url) => !localOnly(url));
  if (remote) { ctx.write(ctx.t.notLocal(remote)); return CANNOT_MEASURE; }
  const contract = await readContract(ctx.root, ctx.spec);
  const browser = await ctx.launch();
  if (!browser) { ctx.write(ctx.t.noBrowser); return CANNOT_MEASURE; }
  let measurements;
  try { measurements = await measured(browser, { urls, viewports: contract.viewports }); } catch (error) { ctx.write(ctx.t.measureFailed(error.message)); return CANNOT_MEASURE; }
  const findings = evaluate(measurements, contract);
  await save(ctx, measurements, findings);
  return report(ctx, findings);
}
