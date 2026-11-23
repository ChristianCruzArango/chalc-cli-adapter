// design.mjs — el contrato de diseño en la línea de comandos (spec 038, R5). Responsabilidad ÚNICA: recibir un
// comando, evaluar unas medidas contra el contrato y fijar el código de salida. Razón de cambio: qué comandos hay.
//
// Este archivo lo emite chalc dentro de `.chalc/design/`. Se ejecuta con `node .chalc/design.mjs` y se REGENERA
// al equipar el repo: no lo edites. El contrato se ajusta en `.chalc/design.contract.json`.

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readContract } from './lib/contract.mjs';
import { evaluate } from './lib/evaluate.mjs';
import { messageOf, textOf } from './lib/i18n.mjs';
import { launchBrowser } from './lib/launch.mjs';
import { measureCommand } from './lib/measurecmd.mjs';

const option = (args, name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] || '' : ''; };
const positionals = (args) => args.filter((arg, index) => !arg.startsWith('-') && args[index - 1] !== '--spec');
const positional = (args) => positionals(args)[0] || '';

// El idioma del proyecto (el del portón). Sin él, inglés.
async function languageOf(root) {
  try { return JSON.parse(await readFile(join(root, '.chalc', 'gate.json'), 'utf8')).language || 'en'; } catch { return 'en'; }
}

// Las medidas de `file`, o null si no se pueden leer o no lo son.
async function measurementsOf(root, file) {
  try {
    const parsed = JSON.parse(await readFile(resolve(root, file), 'utf8'));
    return Array.isArray(parsed?.viewports) ? parsed : null;
  } catch { return null; }
}

const COMMANDS = {
  async check(ctx) {
    const file = positional(ctx.args);
    if (!file) { ctx.write(ctx.t.usage); return 1; }
    const measurements = await measurementsOf(ctx.root, file);
    if (!measurements) { ctx.write(ctx.t.unreadable(file)); return 1; }
    const findings = evaluate(measurements, await readContract(ctx.root, option(ctx.args, '--spec')));
    if (!findings.length) { ctx.write(ctx.t.clean); return 0; }
    for (const finding of findings) ctx.write(messageOf(finding, ctx.lang));
    ctx.write(ctx.t.found(findings.length));
    return 1;
  },
  // Medir en el navegador del sistema (spec 039): las medidas salen de la página real.
  measure: (ctx) => measureCommand({ ...ctx, positionals: positionals(ctx.args), spec: option(ctx.args, '--spec') }),
  async contract(ctx) {
    ctx.write(JSON.stringify(await readContract(ctx.root, option(ctx.args, '--spec')), null, 2));
    return 0;
  }
};

/** Entrada de línea de comandos. Devuelve el código de salida. `write`, `cwd` y `launch` se inyectan en los tests. */
export async function main({ argv = process.argv, cwd = process.cwd(), write = (text) => process.stdout.write(`${text}\n`), launch = launchBrowser } = {}) {
  const [command, ...args] = argv.slice(2);
  const lang = await languageOf(cwd);
  const t = textOf(lang);
  if (!Object.hasOwn(COMMANDS, command ?? '')) { write(t.usage); return 1; }
  return COMMANDS[command]({ root: cwd, lang, t, args, write, launch });
}

// Solo corre cuando se invoca el archivo, no al importarlo desde los tests de chalc.
if (process.argv[1] && /design\.mjs$/.test(process.argv[1])) process.exit(await main());
