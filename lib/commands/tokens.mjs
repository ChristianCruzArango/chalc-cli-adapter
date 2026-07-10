// lib/commands/tokens.mjs — `chalc tokens [ruta] [--json]`: muestra el gasto de IA acumulado del
// proyecto (specs/002-chalc-tokens, R4/R8/R9). Lee .chalc/tokens.jsonl, agrega con tokenreport y
// estima USD con pricing (tabla local + `prices` de la config del usuario). Cero IA, cero red.

import { t } from '../i18n.mjs';
import { loadConfig } from '../ai.mjs';
import { readTokenLog } from '../tokenlog.mjs';
import { aggregateTokenLog } from '../tokenreport.mjs';
import { c, disp, flags, projectPath } from './context.mjs';

const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

// USD para humanos: null → "sin precio"; importes pequeños con 4 decimales para no mostrar $0.00.
function fmtUsd(usd) {
  if (usd === null) return t('tokensNoPrice');
  const n = usd > 0 && usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2);
  return t('tokensUsd', n);
}

function printGroup(title, groups) {
  console.log('\n  ' + c.bold(title));
  const rows = Object.entries(groups).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output));
  const width = Math.max(...rows.map(([name]) => name.length), 8);
  for (const [name, g] of rows) {
    console.log(`  ${name.padEnd(width)}  ${t('tokensRow', fmtK(g.input), fmtK(g.output), g.calls, fmtUsd(g.usd))}`);
  }
}

export async function runTokens() {
  const events = await readTokenLog(projectPath);
  if (!events.length) {
    console.log(c.dim(t('tokensNoHistory', disp(projectPath))));   // R8: claro y con éxito
    return;
  }
  const cfg = await loadConfig();
  const agg = aggregateTokenLog(events, cfg.prices || {});

  if (flags.json) {
    console.log(JSON.stringify(agg, null, 2));   // R9: stdout limpio para scripts/CI
    return;
  }

  console.log('\n' + c.bold(t('tokensTitle')) + '  ' + c.dim(disp(projectPath)));
  console.log('  ' + t('tokensRow', fmtK(agg.total.input), fmtK(agg.total.output), agg.total.calls, fmtUsd(agg.total.usd)));
  printGroup(t('tokensByCommand'), agg.byCommand);
  printGroup(t('tokensByTask'), agg.byTask);
  printGroup(t('tokensByModel'), agg.byModel);
  if (agg.unpriced.length) console.log('\n  ' + c.yellow('! ' + t('tokensUnpricedHint', agg.unpriced.join(', '))));
  console.log('\n  ' + c.dim(t('tokensEstimateNote')) + '\n');
}
