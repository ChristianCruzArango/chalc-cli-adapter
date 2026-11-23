// evals.mjs — los evals activos en la línea de comandos (spec 042). Responsabilidad ÚNICA: listar los casos,
// preparar uno, puntuar una carpeta y comparar corridas. Razón de cambio: qué comandos hay.
//
// Este archivo lo emite chalc dentro de `.chalc/evals/`. Se ejecuta con `node .chalc/evals.mjs` y se REGENERA al
// equipar el repo: no lo edites.
//
// chalc NO lanza ningún modelo: prepara el caso y puntúa lo que quedó. Entre medias, quien evalúa corre a su
// agente —el rol, las instrucciones o el modelo que quiere comparar— en la carpeta preparada.

import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { listCases, loadCase } from './lib/cases.mjs';
import { runChecks } from './lib/checks.mjs';
import { textOf } from './lib/i18n.mjs';
import { compare, totalOf } from './lib/score.mjs';

export const RESULTS_REL = '.chalc/evals-out/results.jsonl';
const WITH_VALUE = new Set(['--out', '--dir', '--label']);
const option = (args, name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] || '' : ''; };
const firstArg = (args) => args.find((arg, index) => !arg.startsWith('-') && !WITH_VALUE.has(args[index - 1])) || '';

async function languageOf(root) {
  try { return JSON.parse(await readFile(join(root, '.chalc', 'gate.json'), 'utf8')).language || 'en'; } catch { return 'en'; }
}

const isEmpty = async (dir) => { try { return (await readdir(dir)).length === 0; } catch { return true; } };

async function readRuns(root) {
  let text = '';
  try { text = await readFile(join(root, ...RESULTS_REL.split('/')), 'utf8'); } catch { return []; }
  return text.split('\n').map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}

// El caso que nombra el primer argumento, o el código de salida con que se rechaza.
async function wanted(ctx, need) {
  const id = firstArg(ctx.args);
  const place = option(ctx.args, need);
  if (!id || !place) { ctx.write(ctx.t.usage); return { code: 1 }; }
  const found = await loadCase(id);
  if (!found) { ctx.write(ctx.t.unknownCase(id)); return { code: 1 }; }
  return { found, place };
}

const COMMANDS = {
  async list(ctx) {
    for (const id of await listCases()) {
      const found = await loadCase(id);
      if (found) ctx.write(`${id} — ${found.title[ctx.lang]}\n  ${ctx.t.trap}: ${found.trap[ctx.lang]}`);
    }
    return 0;
  },
  async prepare(ctx) {
    const { found, place, code } = await wanted(ctx, '--out');
    if (!found) return code;
    const dir = resolve(ctx.root, place);
    if (!await isEmpty(dir)) { ctx.write(ctx.t.notEmpty(place)); return 1; }
    // La trampa NO va en el encargo: quien se evalúa recibe solo lo que recibiría en un trabajo real.
    const files = { ...found.files, 'TASK.md': `# ${ctx.t.task}: ${found.title[ctx.lang]}\n\n${found.prompt[ctx.lang]}\n` };
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, ...rel.split('/'))), { recursive: true });
      await writeFile(join(dir, ...rel.split('/')), content, 'utf8');
    }
    ctx.write(ctx.t.prepared(found.id, place));
    return 0;
  },
  async score(ctx) {
    const { found, place, code } = await wanted(ctx, '--dir');
    if (!found) return code;
    const checks = await runChecks({ dir: resolve(ctx.root, place), files: found.files, checks: found.checks, launch: ctx.launch });
    const total = totalOf(checks);
    for (const c of checks) ctx.write(`${c.status === 'pass' ? '✔' : c.status === 'fail' ? '✖' : '﹣'} ${c.id} (${c.kind}) ${c.earned}/${c.points} — ${ctx.t.statuses[c.status]}${c.detail ? `: ${c.detail}` : ''}`);
    ctx.write(`${ctx.t.total}: ${total.earned}/${total.max} · ${total.percent} %`);
    if (total.skipped) ctx.write(ctx.t.skippedNote(total.skipped));
    const file = join(ctx.root, ...RESULTS_REL.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify({ date: ctx.now().toISOString(), case: found.id, label: option(ctx.args, '--label'), ...total, checks }) + '\n', 'utf8');
    ctx.write(ctx.t.savedIn);
    return 0;
  },
  async compare(ctx) {
    const rows = compare(await readRuns(ctx.root));
    if (!rows.length) { ctx.write(ctx.t.noRuns); return 0; }
    const c = ctx.t.columns;
    const table = [[c.label, c.case, c.runs, c.average], ...rows.map((r) => [r.label || ctx.t.noLabel, r.case, String(r.runs), `${r.average} %`])];
    const widths = table[0].map((_, column) => Math.max(...table.map((row) => row[column].length)));
    for (const row of table) ctx.write(row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd());
    return 0;
  }
};

/** Entrada de línea de comandos. Devuelve el código de salida. `write`, `cwd`, `now` y `launch` se inyectan en los tests. */
export async function main({ argv = process.argv, cwd = process.cwd(), write = (text) => process.stdout.write(`${text}\n`), now = () => new Date(), launch } = {}) {
  const [command, ...args] = argv.slice(2);
  const lang = (await languageOf(cwd)) === 'es' ? 'es' : 'en';
  const t = textOf(lang);
  if (!Object.hasOwn(COMMANDS, command ?? '')) { write(t.usage); return 1; }
  return COMMANDS[command]({ root: cwd, lang, t, args, write, now, launch });
}

// Solo corre cuando se invoca el archivo, no al importarlo desde los tests de chalc.
if (process.argv[1] && /evals\.mjs$/.test(process.argv[1])) process.exit(await main());
