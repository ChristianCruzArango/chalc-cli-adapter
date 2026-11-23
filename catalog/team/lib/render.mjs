// render.mjs — el estado del equipo como tabla (spec 032, R8). Responsabilidad ÚNICA: dibujar para una persona
// lo que `status.json` ya dice. Razón de cambio: qué se ve y en qué orden.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO: recibe el estado y el idioma, devuelve texto. No añade ni interpreta nada que no esté en el estado.

import { textOf } from './i18n.mjs';

const clock = (iso) => String(iso || '').slice(0, 16).replace('T', ' ');

/** El último resultado del portón en pocas palabras, o '—' si no hubo ninguno. */
export function gateCell(gate) {
  if (!gate) return '—';
  return [gate.verdict, gate.stage, gate.score === null ? '' : `${gate.score}%`, gate.fast ? '--fast' : ''].filter(Boolean).join(' ');
}

// Las celdas de una spec, en el orden de las columnas.
function cells(spec, t) {
  const developer = [spec.developer.launcher, spec.developer.tier].filter(Boolean).join(' · ') || '—';
  return [spec.spec, t.state[spec.state] || spec.state, developer, spec.phase || '—', spec.task || '—', `${spec.attempt}/${spec.maxAttempts}`, gateCell(spec.lastGate), clock(spec.lastSignal)];
}

// Filas alineadas por columnas, con dos espacios de margen.
function table(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => '  ' + row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd());
}

function featureLines(feature, t) {
  const head = `${t.feature} ${feature.feature} · ${t.lead} ${feature.lead.agent}${feature.lead.action ? `: ${feature.lead.action}` : ''}${feature.closed ? ` · ${t.closed}` : ''}`;
  if (!feature.specs.length) return [head];
  const rows = table([Object.values(t.columns), ...feature.specs.map((spec) => cells(spec, t))]);
  // Debajo de cada spec, lo que explica por qué no avanza: el bloqueo, el último hallazgo o el posible atasco.
  const notes = feature.specs.flatMap((spec) => [
    spec.blockedBy && `    ${spec.spec}: ${spec.blockedBy}`,
    !spec.blockedBy && spec.state === 'rejected' && `    ${spec.spec}: ${spec.lastFinding}`,
    spec.stalled && `    ${spec.spec}: ⚠ ${t.stalled}`
  ].filter(Boolean));
  return [head, ...rows, ...notes];
}

/** La tabla de `status` en el idioma `lang`. */
export function renderStatus(status, lang) {
  const t = textOf(lang);
  const lines = [`${t.title} · ${t.updated} ${clock(status.updated)}`, ''];
  for (const wait of status.waitingHuman) lines.push(`⏳ ${t.waiting}: ${wait.feature} — ${wait.reason} → ${wait.command}`);
  if (status.waitingHuman.length) lines.push('');
  if (!status.features.length) lines.push(t.empty);
  for (const feature of status.features) lines.push(...featureLines(feature, t), '');
  return lines.join('\n').trimEnd() + '\n';
}
