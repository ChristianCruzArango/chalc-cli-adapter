// checks.mjs — las comprobaciones de un eval (spec 042, R3, R4). Responsabilidad ÚNICA: decir, sin juez, si lo
// que quedó en la carpeta cumple cada condición del caso. Razón de cambio: qué se puede comprobar.
//
// Este archivo lo emite chalc dentro de `.chalc/evals/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Todas son deterministas: la misma carpeta da siempre la misma puntuación, la mire quien la mire. Lo que no se
// puede ejecutar (no hay navegador) se OMITE: ni suma ni resta, y se dice.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contractOf } from '../../design/lib/contract.mjs';
import { evaluate } from '../../design/lib/evaluate.mjs';
import { launchBrowser } from '../../design/lib/launch.mjs';
import { measurePages } from '../../design/lib/measure.mjs';

const DEFAULT_TIMEOUT_MS = 60000;
const pass = () => ({ status: 'pass', detail: '' });
const fail = (detail = '') => ({ status: 'fail', detail });
const skipped = (detail) => ({ status: 'skipped', detail });
const same = (a, b) => String(a).replace(/\r\n/g, '\n') === String(b).replace(/\r\n/g, '\n');

// La ruta de `rel` dentro de `dir`, o '' si se sale: un caso no mira nada fuera de su carpeta.
function inside(dir, rel) {
  const full = resolve(dir, String(rel ?? ''));
  return full.startsWith(resolve(dir) + sep) ? full : '';
}
const textOf = async (dir, rel) => { const full = inside(dir, rel); try { return full ? await readFile(full, 'utf8') : null; } catch { return null; } };

async function unchanged(ctx, check) {
  for (const rel of check.files || []) {
    const now = await textOf(ctx.dir, rel);
    if (ctx.files[rel] === undefined || now === null || !same(now, ctx.files[rel])) return fail(rel);
  }
  return pass();
}

async function matching(ctx, check, wanted) {
  const text = await textOf(ctx.dir, check.file);
  if (text === null) return fail(check.file);
  return new RegExp(check.pattern, check.flags || '').test(text) === wanted ? pass() : fail(check.file);
}

// El entorno del comando, sin lo que deja un corredor de tests que esté por encima: un `node --test` lanzado
// desde dentro de otro hereda `NODE_TEST_CONTEXT` y deja de comportarse como una corrida normal. La puntuación
// no puede depender de quién la lance. (En Windows las variables no distinguen mayúsculas.)
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'NODE_TEST_CONTEXT'));

// Corre el comando del caso en su carpeta, con plazo. El comando lo trae el catálogo, no quien se evalúa.
function command(ctx, check) {
  return new Promise((done) => {
    const child = spawn(check.run, { cwd: ctx.dir, shell: true, windowsHide: true, stdio: 'ignore', env: cleanEnv() });
    const timer = setTimeout(() => { child.kill(); done(fail('timeout')); }, check.timeoutMs || DEFAULT_TIMEOUT_MS);
    const finish = (code) => { clearTimeout(timer); done(code === (check.exit ?? 0) ? pass() : fail(`exit ${code}`)); };
    child.on('error', () => finish(127));
    child.on('close', (code) => finish(code ?? 1));
  });
}

// Mide la página del caso contra el contrato de diseño por defecto.
async function design(ctx, check) {
  const page = inside(ctx.dir, check.page);
  if (!page || !existsSync(page)) return fail(check.page);
  const browser = await ctx.launch();
  if (!browser) return skipped('no-browser');
  try {
    const contract = contractOf();
    const found = evaluate(await measurePages(browser.session, { urls: [pathToFileURL(page).href], viewports: contract.viewports }), contract);
    return found.length ? fail([...new Set(found.map((f) => f.rule))].join(', ')) : pass();
  } catch (error) { return fail(error.message); } finally { await browser.close(); }
}

const KINDS = {
  unchanged,
  exists: async (ctx, check) => (inside(ctx.dir, check.file) && existsSync(inside(ctx.dir, check.file)) ? pass() : fail(check.file)),
  absent: async (ctx, check) => (inside(ctx.dir, check.file) && !existsSync(inside(ctx.dir, check.file)) ? pass() : fail(check.file)),
  matches: (ctx, check) => matching(ctx, check, true),
  'not-matches': (ctx, check) => matching(ctx, check, false),
  command,
  design
};

/** Los tipos de comprobación que existen. */
export const CHECK_KINDS = Object.freeze(Object.keys(KINDS));

/** Ejecuta `checks` sobre `dir`. ctx: { dir, files (estado inicial), checks, launch }. Devuelve un resultado por comprobación. */
export async function runChecks({ dir, files, checks, launch }) {
  const ctx = { dir, files, launch: launch || launchBrowser };
  const results = [];
  for (const check of checks) {
    const run = KINDS[check.kind];
    const outcome = run ? await run(ctx, check) : skipped('unknown-kind');
    results.push({ id: check.id, kind: check.kind, points: check.points, earned: outcome.status === 'pass' ? check.points : 0, ...outcome });
  }
  return results;
}
